import { Button } from "@hyphened/ui/components/button";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { Library } from "lucide-react";
import { useState } from "react";

import { motionLibraryStyles } from "./motion-library.styles";
import { MotionPromptPicker } from "./motion-prompt-picker";

/**
 * Every caption an actor can be conditioned on. Choosing one copies it, which is what every tool
 * and story beat takes as input. The agent reads the same library through `list_motion_prompts`.
 */
export const MotionLibraryPanel = () => {
  const styles = motionLibraryStyles();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string>();

  useHotkey("Mod+K", () => setOpen((current) => !current), { requireReset: true });

  return (
    <>
      <Button
        aria-label="Open the motion library"
        className={styles.launcher()}
        onClick={() => {
          setOpen(true);
        }}
        variant="ghost"
      >
        <Library />
        {copied === undefined ? "Library" : "Copied"}
        <span className={styles.shortcut()}>{formatForDisplay("Mod+K")}</span>
      </Button>

      {open ? (
        <MotionPromptPicker
          action="copy"
          onChoose={(entry) => {
            setOpen(false);
            setCopied(entry.prompt);
            window.setTimeout(() => setCopied(undefined), 1500);
            void navigator.clipboard.writeText(entry.prompt);
          }}
          onOpenChange={setOpen}
          open
        />
      ) : null}
    </>
  );
};
