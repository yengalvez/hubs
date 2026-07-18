/* eslint-disable react/prop-types */

import test from "ava";

require("../../../scripts/shim");

const Module = require("module");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { BotConfigApprovalApiError } = require("../../../admin/src/utils/bot-config-approvals-api");

function withoutProps(props, names) {
  const filtered = { ...props };
  for (const name of names) delete filtered[name];
  return filtered;
}

function elementStub(defaultElement, removedProps = []) {
  return React.forwardRef(function ElementStub({ children, component: Component = defaultElement, ...props }, ref) {
    return (
      <Component ref={ref} {...withoutProps(props, removedProps)}>
        {children}
      </Component>
    );
  });
}

const ButtonStub = elementStub("button", ["color", "variant"]);
const CardHeaderStub = ({ action, subheader, title, titleTypographyProps = {}, ...props }) => {
  const { component: TitleComponent = "span", ...titleProps } = titleTypographyProps;
  return (
    <header {...props}>
      <TitleComponent {...titleProps}>{title}</TitleComponent>
      <p>{subheader}</p>
      {action}
    </header>
  );
};
const ChipStub = ({ label, ...props }) => <span {...withoutProps(props, ["color"])}>{label}</span>;
const CircularProgressStub = props => <span {...withoutProps(props, ["size"])} />;
const DialogStub = ({ children, open, ...props }) =>
  open ? (
    <div role="dialog" {...withoutProps(props, ["onClose"])}>
      {children}
    </div>
  ) : null;

const moduleStubs = {
  "@material-ui/core/Button": ButtonStub,
  "@material-ui/core/Card": elementStub("div"),
  "@material-ui/core/CardActions": elementStub("div"),
  "@material-ui/core/CardContent": elementStub("div"),
  "@material-ui/core/CardHeader": CardHeaderStub,
  "@material-ui/core/Chip": ChipStub,
  "@material-ui/core/CircularProgress": CircularProgressStub,
  "@material-ui/core/Dialog": DialogStub,
  "@material-ui/core/DialogActions": elementStub("div"),
  "@material-ui/core/DialogContent": elementStub("div"),
  "@material-ui/core/DialogContentText": elementStub("p"),
  "@material-ui/core/DialogTitle": elementStub("h2"),
  "@material-ui/core/Typography": elementStub("p", ["color", "gutterBottom", "variant"]),
  "@material-ui/core/styles": { withStyles: () => Component => Component },
  "../utils/with-common-styles": styles => styles,
  "react-admin": { AUTH_ERROR: "AUTH_ERROR", Title: () => null }
};

const originalModuleLoad = Module._load;
Module._load = function loadWithAdminStubs(request, parent, isMain) {
  if (request === "react") return React;
  if (Object.prototype.hasOwnProperty.call(moduleStubs, request)) return moduleStubs[request];
  return originalModuleLoad.call(this, request, parent, isMain);
};

let BotConfigApprovalsComponent;
try {
  ({ BotConfigApprovalsComponent } = require("../../../admin/src/react-components/bot-config-approvals"));
} finally {
  Module._load = originalModuleLoad;
}

global.IS_REACT_ACT_ENVIRONMENT = true;

const FINGERPRINT_A = `v1:${"a".repeat(64)}`;
const FINGERPRINT_B = `v1:${"b".repeat(64)}`;
const FINGERPRINT_C = `v1:${"c".repeat(64)}`;
const classes = new Proxy({}, { get: (_target, key) => String(key) });

function approval(overrides = {}) {
  return {
    approved_at: null,
    approved_by_account_id: null,
    approved_config_fingerprint: null,
    candidate_config_fingerprint: FINGERPRINT_A,
    candidate_summary: {
      chat_enabled: true,
      count: 2,
      enabled: true,
      mobility: "low",
      prompt_bytes: 19,
      prompt_codepoints: 17,
      prompt_present: true
    },
    created_by_account_id: 7,
    current_config_fingerprint: FINGERPRINT_B,
    current_summary: {
      chat_enabled: true,
      count: 2,
      enabled: false,
      mobility: "low",
      prompt_bytes: 19,
      prompt_codepoints: 17,
      prompt_present: true
    },
    entry_mode: "allow",
    hub_sid: "room-a",
    last_quarantine_reason: "legacy_migration",
    last_quarantined_at: "2026-07-18T10:00:00.000Z",
    last_quarantined_by_account_id: null,
    runtime_approved: false,
    state: "quarantined",
    updated_at: "2026-07-18T10:00:00.000Z",
    ...overrides
  };
}

function approved(overrides = {}) {
  return approval({
    approved_at: "2026-07-18T11:00:00.000Z",
    approved_by_account_id: 7,
    approved_config_fingerprint: FINGERPRINT_A,
    current_config_fingerprint: FINGERPRINT_A,
    current_summary: {
      chat_enabled: true,
      count: 2,
      enabled: true,
      mobility: "low",
      prompt_bytes: 19,
      prompt_codepoints: 17,
      prompt_present: true
    },
    last_quarantine_reason: "legacy_migration",
    runtime_approved: true,
    state: "approved",
    ...overrides
  });
}

async function flush(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

function buttonWithText(text) {
  return [...document.querySelectorAll("button")].find(button => button.textContent.includes(text));
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

async function mount(apiClient, onAuthError = async () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<BotConfigApprovalsComponent classes={classes} apiClient={apiClient} onAuthError={onAuthError} />);
  });
  await flush(2);
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

test.serial(
  "the page renders the final redacted summaries and blocks a legacy candidate without a fingerprint",
  async t => {
    const row = approval({
      accidentally_returned_prompt: "secret-prompt-must-not-render",
      candidate_config_fingerprint: null,
      candidate_summary: {
        ...approval().candidate_summary,
        prompt_bytes: 12_000,
        prompt_codepoints: 8_000
      },
      current_config_fingerprint: null,
      current_summary: null
    });
    const apiClient = {
      assertCapability: async () => {},
      listAll: async () => [row],
      approve: async () => {},
      quarantine: async () => {}
    };
    const harness = await mount(apiClient);

    t.true(document.body.textContent.includes("Inventario completo: 1 registro"));
    t.true(document.body.textContent.includes("Presente (12000 bytes, 8000 caracteres Unicode)"));
    t.true(document.body.textContent.includes("Sin configuración de bots"));
    t.true(document.body.textContent.includes("Propietario: cuenta 7 · Acceso: Abierta"));
    t.true(document.body.textContent.includes("Baja"));
    t.false(document.body.textContent.includes("low"));
    t.true(document.body.textContent.includes("no tiene un fingerprint verificable"));
    t.false(document.body.textContent.includes("secret-prompt-must-not-render"));
    t.true(buttonWithText("Aprobar candidato").disabled);
    t.true(buttonWithText("Poner en cuarentena").disabled);
    const article = document.querySelector("article");
    const heading = document.getElementById("bot-config-approval-room-a");
    t.truthy(article);
    t.is(heading.tagName, "H2");
    t.is(article.getAttribute("aria-labelledby"), heading.id);
    t.falsy(document.querySelector("main"));
    await harness.unmount();
  }
);

test.serial("quarantine attribution distinguishes legacy, automatic, and recorded actors", async t => {
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => [
      approval(),
      approval({ hub_sid: "room-b", last_quarantine_reason: "room_closed" }),
      approval({
        hub_sid: "room-c",
        last_quarantine_reason: "bots_disabled",
        last_quarantined_by_account_id: 42
      })
    ],
    approve: async () => {},
    quarantine: async () => {}
  };
  const harness = await mount(apiClient);

  t.true(document.body.textContent.includes("Configuración heredada puesta en cuarentena; migración automática"));
  t.true(document.body.textContent.includes("Sala cerrada; acción automática"));
  t.false(document.body.textContent.includes("Sala cerrada; migración automática"));
  t.true(document.body.textContent.includes("Bots deshabilitados; cuenta 42"));
  await harness.unmount();
});

test.serial("approval confirms the captured fingerprint once and trusts only the durable reload", async t => {
  const inventories = [[approval()], [approved()]];
  const approveCalls = [];
  let listCalls = 0;
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => inventories[Math.min(listCalls++, inventories.length - 1)],
    approve: async (...args) => {
      approveCalls.push(args);
      return { hub_sid: "room-a", status: "approved" };
    },
    quarantine: async () => {}
  };
  const harness = await mount(apiClient);

  await click(buttonWithText("Aprobar candidato"));
  t.true(document.body.textContent.includes("No es solo un cambio de etiqueta"));
  t.true(document.body.textContent.includes(FINGERPRINT_A));
  await click(buttonWithText("Aprobar este fingerprint"));
  await flush(4);

  t.is(approveCalls.length, 1);
  t.is(approveCalls[0][0], "room-a");
  t.is(approveCalls[0][1], FINGERPRINT_A);
  t.is(listCalls, 2);
  t.true(document.body.textContent.includes("Candidato aprobado con coincidencia durable exacta"));
  t.true(document.body.textContent.includes("Aprobada"));
  await harness.unmount();
});

test.serial("a durable match resolves an ambiguous action response without retrying", async t => {
  const inventories = [[approval()], [approved()]];
  let listCalls = 0;
  let approveCalls = 0;
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => inventories[Math.min(listCalls++, inventories.length - 1)],
    approve: async () => {
      approveCalls += 1;
      throw new BotConfigApprovalApiError("network_error", { ambiguous: true });
    },
    quarantine: async () => {}
  };
  const harness = await mount(apiClient);

  await click(buttonWithText("Aprobar candidato"));
  await click(buttonWithText("Aprobar este fingerprint"));
  await flush(4);

  t.is(approveCalls, 1);
  t.is(listCalls, 2);
  t.true(document.body.textContent.includes("Candidato aprobado con coincidencia durable exacta"));
  t.false(document.body.textContent.includes("No se pudo confirmar la respuesta"));
  await harness.unmount();
});

test.serial("a stale 409 is never retried and replaces the reviewed row before another approval", async t => {
  const changed = approval({ candidate_config_fingerprint: FINGERPRINT_C, updated_at: "2026-07-18T12:00:00.000Z" });
  const inventories = [[approval()], [changed]];
  let listCalls = 0;
  let approveCalls = 0;
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => inventories[Math.min(listCalls++, inventories.length - 1)],
    approve: async () => {
      approveCalls += 1;
      throw new BotConfigApprovalApiError("fingerprint_mismatch", { status: 409 });
    },
    quarantine: async () => {}
  };
  const harness = await mount(apiClient);

  await click(buttonWithText("Aprobar candidato"));
  await click(buttonWithText("Aprobar este fingerprint"));
  await flush(4);

  t.is(approveCalls, 1);
  t.is(listCalls, 2);
  t.true(document.body.textContent.includes("La configuración cambió mientras la revisabas"));
  t.true(document.body.textContent.includes(FINGERPRINT_C));
  t.false(document.body.textContent.includes(FINGERPRINT_A));
  await harness.unmount();
});

test.serial("quarantine is individual, confirmed, and observed from the durable inventory", async t => {
  const inventories = [[approved()], [approval({ current_config_fingerprint: FINGERPRINT_B })]];
  let listCalls = 0;
  const quarantineCalls = [];
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => inventories[Math.min(listCalls++, inventories.length - 1)],
    approve: async () => {},
    quarantine: async (...args) => {
      quarantineCalls.push(args);
      return { hub_sid: "room-a", status: "quarantined" };
    }
  };
  const harness = await mount(apiClient);

  await click(buttonWithText("Poner en cuarentena"));
  t.true(document.body.textContent.includes("conserva el candidato"));
  await click(buttonWithText("Confirmar cuarentena"));
  await flush(4);

  t.is(quarantineCalls.length, 1);
  t.is(quarantineCalls[0][0], "room-a");
  t.true(document.body.textContent.includes("Cuarentena durable confirmada"));
  await harness.unmount();
});

test.serial("an authorization failure clears the page and delegates exactly one auth error", async t => {
  const authStatuses = [];
  const apiClient = {
    assertCapability: async () => {
      throw new BotConfigApprovalApiError("missing_auth_token", { status: 401 });
    },
    listAll: async () => [approval()],
    approve: async () => {},
    quarantine: async () => {}
  };
  const harness = await mount(apiClient, async status => authStatuses.push(status));

  t.deepEqual(authStatuses, [401]);
  t.true(document.body.textContent.includes("no tiene permisos de administración"));
  t.false(document.body.textContent.includes("room-a"));
  t.falsy(buttonWithText("Aprobar candidato"));
  await harness.unmount();
});

test.serial("an action authorization failure delegates once and does not refetch with the rejected token", async t => {
  const authStatuses = [];
  let listCalls = 0;
  let approveCalls = 0;
  const apiClient = {
    assertCapability: async () => {},
    listAll: async () => {
      listCalls += 1;
      return [approval()];
    },
    approve: async () => {
      approveCalls += 1;
      throw new BotConfigApprovalApiError("forbidden", { status: 403 });
    },
    quarantine: async () => {}
  };
  const harness = await mount(apiClient, async status => authStatuses.push(status));

  await click(buttonWithText("Aprobar candidato"));
  await click(buttonWithText("Aprobar este fingerprint"));
  await flush(2);

  t.is(approveCalls, 1);
  t.is(listCalls, 1);
  t.deepEqual(authStatuses, [403]);
  t.true(document.body.textContent.includes("no tiene permisos de administración"));
  t.false(document.body.textContent.includes("room-a"));
  t.falsy(buttonWithText("Aprobar candidato"));
  await harness.unmount();
});

test.serial("unmount aborts a capability request and never proceeds to inventory", async t => {
  let capabilitySignal;
  let listCalls = 0;
  const apiClient = {
    assertCapability: ({ signal }) => {
      capabilitySignal = signal;
      return new Promise(() => {});
    },
    listAll: async () => {
      listCalls += 1;
      return [];
    },
    approve: async () => {},
    quarantine: async () => {}
  };
  const harness = await mount(apiClient);

  t.false(capabilitySignal.aborted);
  await harness.unmount();
  t.true(capabilitySignal.aborted);
  t.is(listCalls, 0);
});
