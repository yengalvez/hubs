import test from "ava";
import { renderToStaticMarkup } from "react-dom/server";

import { formatMessageBody } from "../../../src/utils/chat-message";

test("renders safe chat links without granting opener access", t => {
  const { formattedBody } = formatMessageBody("Visita example.com");
  const html = renderToStaticMarkup(formattedBody);

  t.regex(html, /href="https:\/\/example\.com"/);
  t.regex(html, /rel="noopener noreferrer"/);
  t.regex(html, /target="_blank"/);
});

test("does not turn unsafe URL schemes into links", t => {
  const { formattedBody } = formatMessageBody("javascript:alert(1)");
  const html = renderToStaticMarkup(formattedBody);

  t.false(html.includes("<a "));
  t.true(html.includes("javascript:alert(1)"));
});
