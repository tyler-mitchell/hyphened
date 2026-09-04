import type { TimelineRuntime } from "@coretime/core";
import { useTimelineCommand } from "@coretime/editor";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { MotionPromptPicker } from "../library/motion-prompt-picker";
import { commitSceneChanges, setSpanPromptChange } from "../../scene/actors";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { promptSpanEditorStyles } from "./prompt-span-editor.styles";

/** Re-captions one prompt span from the same library the agent's tools read. */
export const PromptSpanEditor = ({
  item,
  timeline,
}: {
  readonly item: string;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}) => {
  const [open, setOpen] = useState(false);
  const command = useTimelineCommand();
  return (
    <>
      <button
        aria-label="Change this prompt"
        className={promptSpanEditorStyles()}
        disabled={command.pending}
        // The item body owns pointer-down for the move drag, so the button takes its own.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        title={command.errorMessage}
        type="button"
      >
        <Pencil />
      </button>
      {open ? (
        <MotionPromptPicker
          action="set"
          onChoose={(entry) => {
            setOpen(false);
            void command.run(async () => {
              const change = await setSpanPromptChange({ item, prompt: entry.prompt, timeline });
              await commitSceneChanges({
                author: "editor/set-prompt",
                changes: [change],
                timeline,
              });
            });
          }}
          onOpenChange={setOpen}
          open
        />
      ) : null}
    </>
  );
};
