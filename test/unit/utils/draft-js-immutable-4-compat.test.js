import path from "path";
import test from "ava";
import { ContentState, EditorState, Modifier, SelectionState, convertToRaw } from "draft-js";
import { createEditorStateWithText } from "@draft-js-plugins/editor";

const randomizeBlockMapKeys = require("draft-js/lib/randomizeBlockMapKeys");

test("uses the patched Immutable.js release for Draft.js", t => {
  const draftPackageDirectory = path.dirname(require.resolve("draft-js/package.json"));
  const immutablePackagePath = require.resolve("immutable/package.json", { paths: [draftPackageDirectory] });

  t.is(require(immutablePackagePath).version, "4.3.9");
});

test("keeps Draft.js block arrays and randomized maps compatible with Immutable.js 4", t => {
  const content = ContentState.createFromText("uno\ndos");
  const blocks = content.getBlocksAsArray();

  t.is(blocks.length, 2);
  t.true(blocks.every(block => typeof block.getKey === "function"));

  const randomized = randomizeBlockMapKeys(content.getBlockMap());
  t.is(randomized.size, 2);
  t.true(
    randomized
      .valueSeq()
      .toArray()
      .every(block => typeof block.getText === "function")
  );
  t.notDeepEqual(randomized.keySeq().toArray(), content.getBlockMap().keySeq().toArray());
});

test("supports the Tweet editor text and emoji insertion path", t => {
  let editorState = createEditorStateWithText("Mensaje");
  const content = editorState.getCurrentContent();
  const blockKey = content.getFirstBlock().getKey();
  const selection = SelectionState.createEmpty(blockKey).merge({ anchorOffset: 7, focusOffset: 7 });
  const contentWithEntity = content.createEntity("emoji", "IMMUTABLE", { emojiUnicode: "🐤" });
  const entityKey = contentWithEntity.getLastCreatedEntityKey();
  const withEmoji = Modifier.insertText(contentWithEntity, selection, "🐤 ", null, entityKey);

  editorState = EditorState.push(editorState, withEmoji, "insert-emoji");

  t.is(editorState.getCurrentContent().getPlainText(), "Mensaje🐤 ");
  t.is(convertToRaw(editorState.getCurrentContent()).blocks[0].text, "Mensaje🐤 ");
});
