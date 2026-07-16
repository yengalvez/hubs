import test from "ava";

import { parseJSONObject } from "../../../src/utils/json-utils";

test("parses an OAuth credential object", t => {
  t.deepEqual(parseJSONObject('{"token":"token","email":"user@example.com"}'), {
    token: "token",
    email: "user@example.com"
  });
});

test("rejects malformed and non-object JSON without throwing", t => {
  t.is(parseJSONObject("{"), null);
  t.is(parseJSONObject('"credentials"'), null);
  t.is(parseJSONObject("[]"), null);
  t.is(parseJSONObject(null), null);
});
