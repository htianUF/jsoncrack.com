import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, TextInput, Button, Group, ColorInput } from "@mantine/core";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";
import { modify, applyEdits } from "jsonc-parser";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const updateNodeById = useGraph(state => state.updateNodeById);

  const [editing, setEditing] = React.useState(false);
  // editableFields holds string values for each editable key (key -> stringified value)
  const [editableFields, setEditableFields] = React.useState<Record<string, string>>({});

  // list of rows we will render as editable (primitive keys)
  const editableRows = React.useMemo(() => {
    if (!nodeData) return [] as NodeData["text"];
    return nodeData.text.filter(r => r.key && r.type !== "array" && r.type !== "object");
  }, [nodeData]);

  React.useEffect(() => {
    if (!nodeData) {
      setEditableFields({});
      setEditing(false);
      return;
    }

    const initial: Record<string, string> = {};
    editableRows.forEach(r => {
      initial[String(r.key)] = r.value === null || typeof r.value === "undefined" ? "" : String(r.value);
    });
    setEditableFields(initial);
    setEditing(false);
  }, [nodeData, editableRows]);

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group gap="xs">
              {editing ? (
                <>
                  <Button
                    size="xs"
                    onClick={() => {
                      // Cancel edits: reset values from nodeData
                      const reset: Record<string, string> = {};
                      editableRows.forEach(r => {
                        reset[String(r.key)] = r.value === null || typeof r.value === "undefined" ? "" : String(r.value);
                      });
                      setEditableFields(reset);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    color="green"
                    onClick={() => {
                      if (!nodeData) return;

                      const newText = (nodeData.text || []).slice();

                      // apply edits to JSON editor using jsonc-parser
                      try {
                        let currentJson = useJson.getState().getJson();
                        const basePath = nodeData.path ?? [];

                        // for each editable field, convert to proper type based on original row.type
                        editableRows.forEach(r => {
                          const key = String(r.key as string);
                          const raw = editableFields[key];
                          let typed: any = raw;

                          if (r.type === "number") {
                            const n = Number(raw);
                            typed = Number.isNaN(n) ? raw : n;
                          } else if (r.type === "boolean") {
                            typed = raw === "true";
                          } else if (r.type === "null") {
                            typed = null;
                          } else {
                            // string
                            typed = raw;
                          }

                          const edits = modify(currentJson, [...basePath, key], typed, {
                            formattingOptions: { insertSpaces: true, tabSize: 2 },
                          });
                          currentJson = applyEdits(currentJson, edits);
                        });

                        useJson.getState().setJson(currentJson);
                        // also update the left editor contents so it displays the new JSON
                        try {
                          useFile.getState().setContents({ contents: currentJson, hasChanges: true, skipUpdate: true });
                        } catch (_) {
                          /* ignore */
                        }

                        // re-select node if possible after reparse
                        try {
                          const nodesAfter = useGraph.getState().nodes;
                          const match = nodesAfter.find(n => JSON.stringify(n.path) === JSON.stringify(nodeData.path));
                          if (match) useGraph.getState().setSelectedNode(match);
                        } catch (_) {
                          /* ignore */
                        }
                      } catch (error) {
                        // fallback: update graph node only
                        editableRows.forEach(r => {
                          const key = String(r.key as string);
                          const idx = newText.findIndex(t => t.key === r.key);
                          if (idx >= 0) {
                            newText[idx] = { ...newText[idx], value: editableFields[key] } as any;
                          } else {
                            newText.push({ key, value: editableFields[key], type: r.type } as any);
                          }
                        });
                        updateNodeById(nodeData.id, n => ({ ...n, text: newText }));
                      }

                      setEditing(false);
                      onClose();
                    }}
                  >
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button size="xs" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <CloseButton onClick={onClose} />
                </>
              )}
            </Group>
          </Flex>
          {!editing ? (
            <ScrollArea.Autosize mah={250} maw={600}>
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            </ScrollArea.Autosize>
          ) : (
            <Stack gap="xs">
              {editableRows.map(r => {
                const key = String(r.key as string);
                const val = editableFields[key] ?? "";

                // simple heuristic: if key contains "color" render ColorInput
                if (key.toLowerCase().includes("color") && r.type === "string") {
                  return (
                    <ColorInput
                      key={key}
                      label={key}
                      value={val}
                      onChange={c => setEditableFields(prev => ({ ...prev, [key]: c }))}
                      withEyeDropper={false}
                    />
                  );
                }

                // boolean input (rendered as text input for simplicity)
                if (r.type === "boolean") {
                  return (
                    <TextInput
                      key={key}
                      label={key}
                      value={val}
                      onChange={e => setEditableFields(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  );
                }

                // default text input for strings/numbers/null
                return (
                  <TextInput
                    key={key}
                    label={key}
                    value={val}
                    onChange={e => setEditableFields(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                );
              })}
            </Stack>
          )}
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
