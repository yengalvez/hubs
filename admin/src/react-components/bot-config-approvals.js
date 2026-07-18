/* eslint-disable @calm/react-intl/missing-formatted-message */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { AUTH_ERROR, Title } from "react-admin";
import { withStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import Card from "@material-ui/core/Card";
import CardActions from "@material-ui/core/CardActions";
import CardContent from "@material-ui/core/CardContent";
import CardHeader from "@material-ui/core/CardHeader";
import Chip from "@material-ui/core/Chip";
import CircularProgress from "@material-ui/core/CircularProgress";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogContentText from "@material-ui/core/DialogContentText";
import DialogTitle from "@material-ui/core/DialogTitle";
import Typography from "@material-ui/core/Typography";

import configs from "../utils/configs";
import withCommonStyles from "../utils/with-common-styles";
import {
  BotConfigApprovalApiError,
  botConfigApprovalContract,
  createBotConfigApprovalClient
} from "../utils/bot-config-approvals-api";

const REASON_LABELS = Object.freeze({
  admin_quarantine: "Cuarentena solicitada por administración",
  bots_disabled: "Bots deshabilitados",
  bots_removed: "Configuración de bots eliminada",
  legacy_migration: "Configuración heredada puesta en cuarentena",
  room_closed: "Sala cerrada",
  unapproved_bot_config_change: "Configuración modificada sin aprobación"
});

const ENTRY_MODE_LABELS = Object.freeze({
  allow: "Abierta",
  deny: "Cerrada",
  invite: "Solo con invitación"
});

const MOBILITY_LABELS = Object.freeze({
  high: "Alta",
  low: "Baja",
  medium: "Media",
  static: "Estática"
});

const ERROR_LABELS = Object.freeze({
  approval_unavailable: "La decisión no está disponible temporalmente; no se modificó la aprobación.",
  config_too_large: "El candidato supera el tamaño permitido y permanece en cuarentena.",
  fingerprint_mismatch: "La configuración cambió mientras la revisabas. El inventario se recargó; revísala de nuevo.",
  inactive_candidate: "El candidato está deshabilitado o no contiene bots activos y no se puede aprobar.",
  invalid_candidate: "El candidato ya no es válido y permanece en cuarentena.",
  invalid_config: "La configuración ya no es válida y permanece en cuarentena.",
  invalid_request: "Reticulum rechazó la forma de la solicitud; no se tomó ninguna decisión.",
  missing_auth_token: "La sesión de administración ya no está disponible.",
  network_error: "No se pudo confirmar la respuesta. Se consultó de nuevo el estado durable sin repetir la acción.",
  not_found: "La sala o su registro de aprobación ya no existe. El inventario se recargó.",
  room_limit: "Se alcanzó el límite global de salas con bots; el candidato no fue aprobado.",
  unavailable: "La decisión no está disponible temporalmente; no se modificó la aprobación."
});

const styles = withCommonStyles(theme => ({
  page: {
    alignSelf: "stretch",
    width: "auto",
    maxWidth: 1120,
    boxSizing: "border-box"
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    width: "100%"
  },
  notice: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 4,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
    backgroundColor: "#eef3ff",
    border: "1px solid #aabce8"
  },
  errorNotice: {
    backgroundColor: "#fff1f1",
    borderColor: "#b43b3b"
  },
  warningNotice: {
    backgroundColor: "#fff8e1",
    borderColor: "#b7791f"
  },
  progress: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(3, 0)
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: theme.spacing(2),
    width: "100%"
  },
  card: {
    width: "100%",
    overflow: "hidden"
  },
  cardHeader: {
    alignItems: "flex-start"
  },
  cardTitle: {
    overflowWrap: "anywhere",
    wordBreak: "break-word"
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: theme.spacing(1, 2),
    margin: theme.spacing(2, 0)
  },
  definition: {
    margin: 0,
    minWidth: 0,
    "& dt": {
      fontWeight: 600,
      marginTop: theme.spacing(1)
    },
    "& dd": {
      margin: theme.spacing(0.5, 0, 0),
      overflowWrap: "anywhere"
    }
  },
  fingerprint: {
    display: "block",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    overflowWrap: "anywhere",
    wordBreak: "break-all"
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    padding: theme.spacing(2)
  },
  dialogFingerprint: {
    display: "block",
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: "#f5f5f5",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    overflowWrap: "anywhere",
    wordBreak: "break-all"
  }
}));

function defaultClient() {
  return createBotConfigApprovalClient({
    fetchImpl: (...args) => window.fetch(...args),
    getToken: () =>
      window.APP &&
      window.APP.store &&
      window.APP.store.state &&
      window.APP.store.state.credentials &&
      window.APP.store.state.credentials.token,
    buildUrl: path => (configs.RETICULUM_SERVER ? `https://${configs.RETICULUM_SERVER}${path}` : path)
  });
}

async function defaultAuthErrorHandler(status) {
  const authProvider = window.APP && window.APP.authProvider;
  if (typeof authProvider === "function") {
    try {
      await authProvider(AUTH_ERROR, { status });
    } catch {
      // The existing auth provider rejects after initiating its redirect.
    }
  }
}

function isAbort(error) {
  return error && error.name === "AbortError";
}

function errorText(error) {
  if (error && (error.status === 401 || error.status === 403)) return "La sesión no tiene permisos de administración.";
  if (error && ERROR_LABELS[error.code]) return ERROR_LABELS[error.code];
  if (error instanceof BotConfigApprovalApiError && error.status === 502) {
    return "Reticulum devolvió un contrato de aprobación inesperado. Las acciones quedan bloqueadas.";
  }
  return "No se pudo cargar un inventario completo y verificable. Las acciones quedan bloqueadas.";
}

function formatTimestamp(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function fingerprint(value) {
  return value || "—";
}

function RedactedSummary({ classes, summary, title }) {
  return (
    <section>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {summary ? (
        <dl className={`${classes.definition} ${classes.summaryGrid}`}>
          <div>
            <dt>Habilitada</dt>
            <dd>{summary.enabled ? "Sí" : "No"}</dd>
          </div>
          <div>
            <dt>Número de bots</dt>
            <dd>{summary.count}</dd>
          </div>
          <div>
            <dt>Movilidad</dt>
            <dd>{MOBILITY_LABELS[summary.mobility]}</dd>
          </div>
          <div>
            <dt>Chat</dt>
            <dd>{summary.chat_enabled ? "Sí" : "No"}</dd>
          </div>
          <div>
            <dt>Prompt redactado</dt>
            <dd>
              {summary.prompt_present
                ? `Presente (${summary.prompt_bytes} bytes, ${summary.prompt_codepoints} caracteres Unicode)`
                : "No presente"}
            </dd>
          </div>
        </dl>
      ) : (
        <Typography variant="body2">Sin configuración de bots.</Typography>
      )}
    </section>
  );
}

RedactedSummary.propTypes = {
  classes: PropTypes.object.isRequired,
  summary: PropTypes.shape({
    chat_enabled: PropTypes.bool.isRequired,
    count: PropTypes.number.isRequired,
    enabled: PropTypes.bool.isRequired,
    mobility: PropTypes.string.isRequired,
    prompt_bytes: PropTypes.number.isRequired,
    prompt_codepoints: PropTypes.number.isRequired,
    prompt_present: PropTypes.bool.isRequired
  }),
  title: PropTypes.string.isRequired
};

function durableDecisionMatches(decision, approvals) {
  const row = approvals.find(approval => approval.hub_sid === decision.approval.hub_sid);
  if (!row) return false;
  if (decision.type === "quarantine") {
    return row.state === "quarantined" && row.approved_config_fingerprint === null && !row.runtime_approved;
  }
  return (
    row.state === "approved" &&
    row.candidate_config_fingerprint === decision.expectedFingerprint &&
    row.approved_config_fingerprint === decision.expectedFingerprint &&
    row.current_config_fingerprint === decision.expectedFingerprint
  );
}

export function BotConfigApprovalsComponent({ classes, apiClient, onAuthError }) {
  const client = useMemo(() => apiClient || defaultClient(), [apiClient]);
  const authErrorHandler = onAuthError || defaultAuthErrorHandler;
  const mountedRef = useRef(false);
  const loadAbortRef = useRef(null);
  const actionAbortRef = useRef(null);
  const loadEpochRef = useRef(0);
  const [approvals, setApprovals] = useState([]);
  const [inventoryComplete, setInventoryComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(null);
  const [decision, setDecision] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadInventory = useCallback(
    async ({ clearNotice = true } = {}) => {
      if (loadAbortRef.current) loadAbortRef.current.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      const epoch = ++loadEpochRef.current;

      if (mountedRef.current) {
        setLoading(true);
        setInventoryComplete(false);
        setApprovals([]);
        if (clearNotice) setNotice(null);
      }

      try {
        await client.assertCapability({ signal: controller.signal });
        const completeInventory = await client.listAll({ signal: controller.signal });
        if (!mountedRef.current || epoch !== loadEpochRef.current) return null;
        setApprovals(completeInventory);
        setInventoryComplete(true);
        return completeInventory;
      } catch (error) {
        if (isAbort(error)) return null;
        if (!mountedRef.current || epoch !== loadEpochRef.current) return null;
        setApprovals([]);
        setInventoryComplete(false);
        setNotice({ kind: "error", text: errorText(error) });
        if (error && (error.status === 401 || error.status === 403)) await authErrorHandler(error.status);
        return null;
      } finally {
        if (mountedRef.current && epoch === loadEpochRef.current) setLoading(false);
      }
    },
    [authErrorHandler, client]
  );

  useEffect(() => {
    mountedRef.current = true;
    loadInventory();
    return () => {
      mountedRef.current = false;
      loadEpochRef.current += 1;
      if (loadAbortRef.current) loadAbortRef.current.abort();
      if (actionAbortRef.current) actionAbortRef.current.abort();
    };
  }, [loadInventory]);

  const executeDecision = useCallback(async () => {
    if (!decision || operation) return;
    const capturedDecision = decision;
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setOperation({ hubSid: capturedDecision.approval.hub_sid, type: capturedDecision.type });
    setNotice(null);

    let actionError = null;
    try {
      if (capturedDecision.type === "approve") {
        await client.approve(capturedDecision.approval.hub_sid, capturedDecision.expectedFingerprint, {
          signal: controller.signal
        });
      } else {
        await client.quarantine(capturedDecision.approval.hub_sid, { signal: controller.signal });
      }
    } catch (error) {
      if (isAbort(error)) return;
      if (error && (error.status === 401 || error.status === 403)) {
        if (mountedRef.current) {
          setApprovals([]);
          setInventoryComplete(false);
          setNotice({ kind: "error", text: errorText(error) });
          setDecision(null);
          setOperation(null);
          actionAbortRef.current = null;
        }
        try {
          await authErrorHandler(error.status);
        } catch {
          // Auth handlers may reject after initiating their redirect.
        }
        return;
      }
      actionError = error;
    }

    if (!mountedRef.current || controller.signal.aborted) return;
    const durableInventory = await loadInventory({ clearNotice: false });
    if (!mountedRef.current || controller.signal.aborted) return;

    const durableMatch = durableInventory && durableDecisionMatches(capturedDecision, durableInventory);

    if (!durableMatch && actionError) {
      setNotice({ kind: "error", text: errorText(actionError) });
    } else if (!durableMatch) {
      setNotice({
        kind: "error",
        text: "Reticulum respondió, pero el inventario durable no confirma la decisión. No se repitió la acción."
      });
    } else if (capturedDecision.type === "approve") {
      const row = durableInventory.find(item => item.hub_sid === capturedDecision.approval.hub_sid);
      setNotice({
        kind: row.runtime_approved ? "success" : "warning",
        text: row.runtime_approved
          ? "Candidato aprobado con coincidencia durable exacta. La readiness del runner se verifica por separado."
          : "Candidato aprobado de forma durable, pero la sala no está habilitada para runtime."
      });
    } else {
      setNotice({
        kind: "warning",
        text: "Cuarentena durable confirmada. La parada inmediata del runner se verifica por separado."
      });
    }

    setDecision(null);
    setOperation(null);
    actionAbortRef.current = null;
  }, [authErrorHandler, client, decision, loadInventory, operation]);

  const openApprove = approval => {
    setDecision({
      approval,
      expectedFingerprint: approval.candidate_config_fingerprint,
      type: "approve"
    });
  };

  const openQuarantine = approval => {
    setDecision({ approval, expectedFingerprint: null, type: "quarantine" });
  };

  const busy = loading || operation !== null;

  return (
    <div className={`${classes.container} ${classes.page}`} aria-busy={busy}>
      <div className={classes.headerRow}>
        <div>
          <Typography variant="h5" component="h1">
            Aprobaciones de configuraciones de bots
          </Typography>
          <Typography variant="body2">
            Inventario redactado. Nunca muestra el prompt ni el JSON de configuración.
          </Typography>
        </div>
        <Button variant="outlined" onClick={() => loadInventory()} disabled={busy}>
          Actualizar inventario
        </Button>
      </div>

      <div className={`${classes.notice} ${classes.warningNotice}`} role="note">
        Una aprobación durable no demuestra que el runner esté listo. Una cuarentena durable tampoco garantiza parada
        inmediata; ambos estados se verifican operativamente por separado.
      </div>

      {notice && (
        <div
          className={`${classes.notice} ${notice.kind === "error" ? classes.errorNotice : ""} ${
            notice.kind === "warning" ? classes.warningNotice : ""
          }`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}

      {loading && (
        <div className={classes.progress} role="status">
          <CircularProgress size={28} />
          <span>Cargando y verificando el inventario completo…</span>
        </div>
      )}

      {!loading && inventoryComplete && approvals.length === 0 && (
        <Typography role="status">No existen registros de aprobación de bots.</Typography>
      )}

      {!loading && inventoryComplete && approvals.length > 0 && (
        <>
          <Typography variant="body2" gutterBottom role="status">
            Inventario completo: {approvals.length} {approvals.length === 1 ? "registro" : "registros"}.
          </Typography>
          <section className={classes.cards} aria-label="Inventario de aprobaciones de bots">
            {approvals.map(approval => {
              const summary = approval.candidate_summary;
              const candidateIsActive = summary.enabled && summary.count > 0;
              const canApprove =
                !busy &&
                approval.state === "quarantined" &&
                candidateIsActive &&
                botConfigApprovalContract.FINGERPRINT_PATTERN.test(approval.candidate_config_fingerprint || "");
              const canQuarantine = !busy && approval.state === "approved";
              const headingId = `bot-config-approval-${approval.hub_sid}`;
              return (
                <Card aria-labelledby={headingId} className={classes.card} component="article" key={approval.hub_sid}>
                  <CardHeader
                    className={classes.cardHeader}
                    title={approval.hub_sid}
                    titleTypographyProps={{ className: classes.cardTitle, component: "h2", id: headingId }}
                    subheader={`Actualizado: ${formatTimestamp(approval.updated_at)}`}
                    action={
                      <Chip
                        color={approval.state === "approved" ? "primary" : "default"}
                        label={approval.state === "approved" ? "Aprobada" : "En cuarentena"}
                      />
                    }
                  />
                  <CardContent>
                    <Typography variant="body2" color="textSecondary">
                      Coincidencia durable válida: {approval.runtime_approved ? "Sí" : "No"}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Propietario: {approval.created_by_account_id ? `cuenta ${approval.created_by_account_id}` : "—"} ·
                      Acceso: {ENTRY_MODE_LABELS[approval.entry_mode]}
                    </Typography>
                    {approval.state === "quarantined" &&
                      approval.candidate_config_fingerprint !== approval.current_config_fingerprint && (
                        <Typography variant="body2">
                          El candidato preservado difiere de la configuración actual deshabilitada. Aprobarlo lo vuelve
                          a aplicar.
                        </Typography>
                      )}
                    {approval.state === "quarantined" && !approval.candidate_config_fingerprint && (
                      <Typography variant="body2">
                        El candidato heredado no tiene un fingerprint verificable. Solo puede permanecer en cuarentena;
                        la aprobación está bloqueada.
                      </Typography>
                    )}

                    <RedactedSummary classes={classes} summary={summary} title="Candidato preservado" />
                    <RedactedSummary
                      classes={classes}
                      summary={approval.current_summary}
                      title="Configuración actual"
                    />

                    <dl className={classes.definition}>
                      <dt>Fingerprint candidato</dt>
                      <dd>
                        <code className={classes.fingerprint}>
                          {fingerprint(approval.candidate_config_fingerprint)}
                        </code>
                      </dd>
                      <dt>Fingerprint aprobado</dt>
                      <dd>
                        <code className={classes.fingerprint}>{fingerprint(approval.approved_config_fingerprint)}</code>
                      </dd>
                      <dt>Fingerprint actual</dt>
                      <dd>
                        <code className={classes.fingerprint}>{fingerprint(approval.current_config_fingerprint)}</code>
                      </dd>
                      <dt>Última aprobación</dt>
                      <dd>
                        {approval.approved_by_account_id
                          ? `Cuenta ${approval.approved_by_account_id}, ${formatTimestamp(approval.approved_at)}`
                          : "—"}
                      </dd>
                      <dt>Última cuarentena</dt>
                      <dd>
                        {approval.last_quarantined_at
                          ? `${REASON_LABELS[approval.last_quarantine_reason] || approval.last_quarantine_reason}; ${
                              approval.last_quarantined_by_account_id
                                ? `cuenta ${approval.last_quarantined_by_account_id}`
                                : approval.last_quarantine_reason === "legacy_migration"
                                  ? "migración automática"
                                  : "acción automática"
                            }, ${formatTimestamp(approval.last_quarantined_at)}`
                          : "—"}
                      </dd>
                    </dl>
                  </CardContent>
                  <CardActions className={classes.actions}>
                    <Button
                      color="primary"
                      variant="contained"
                      disabled={!canApprove}
                      onClick={() => openApprove(approval)}
                      aria-label={`Aprobar candidato de ${approval.hub_sid}`}
                    >
                      Aprobar candidato
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={!canQuarantine}
                      onClick={() => openQuarantine(approval)}
                      aria-label={`Poner ${approval.hub_sid} en cuarentena`}
                    >
                      Poner en cuarentena
                    </Button>
                  </CardActions>
                </Card>
              );
            })}
          </section>
        </>
      )}

      <Dialog
        open={decision !== null}
        onClose={() => {
          if (!operation) setDecision(null);
        }}
        aria-labelledby="bot-config-decision-title"
      >
        {decision && (
          <>
            <DialogTitle id="bot-config-decision-title">
              {decision.type === "approve" ? "Confirmar aprobación" : "Confirmar cuarentena"}
            </DialogTitle>
            <DialogContent>
              <DialogContentText component="div">
                {decision.type === "approve" ? (
                  <>
                    Esta acción vuelve a escribir el candidato preservado de <b>{decision.approval.hub_sid}</b> y puede
                    habilitar hasta {decision.approval.candidate_summary.count} bots cuando la sala esté abierta. No es
                    solo un cambio de etiqueta.
                    <code className={classes.dialogFingerprint}>{decision.expectedFingerprint}</code>
                  </>
                ) : (
                  <>
                    Esta acción deshabilita los bots de <b>{decision.approval.hub_sid}</b> y conserva el candidato para
                    una revisión posterior. La parada del runner se comprueba por separado.
                  </>
                )}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDecision(null)} disabled={operation !== null}>
                Cancelar
              </Button>
              <Button color="primary" variant="contained" onClick={executeDecision} disabled={operation !== null}>
                {operation
                  ? "Aplicando…"
                  : decision.type === "approve"
                    ? "Aprobar este fingerprint"
                    : "Confirmar cuarentena"}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}

BotConfigApprovalsComponent.propTypes = {
  apiClient: PropTypes.shape({
    approve: PropTypes.func.isRequired,
    assertCapability: PropTypes.func.isRequired,
    listAll: PropTypes.func.isRequired,
    quarantine: PropTypes.func.isRequired
  }),
  classes: PropTypes.object.isRequired,
  onAuthError: PropTypes.func
};

const StyledBotConfigApprovals = withStyles(styles)(BotConfigApprovalsComponent);

export function BotConfigApprovals(props) {
  return (
    <>
      <Title title="Aprobaciones de bots" />
      <StyledBotConfigApprovals {...props} />
    </>
  );
}
