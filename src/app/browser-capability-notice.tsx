import { Badge } from "@hyphened/ui/components/badge";
import { Button } from "@hyphened/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hyphened/ui/components/dialog";
import { tv } from "@hyphened/ui/tv";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { SceneDevice } from "./authoring/scene-readiness";

export interface BrowserCapabilities extends SceneDevice {
  readonly webMcp: boolean;
}

const FLAG_URL = "chrome://flags/#enable-webmcp-testing";

const introStyles = tv({
  slots: {
    // The primitive's own width is built for a confirmation; this holds instructions.
    dialog: "sm:max-w-lg",
    list: "divide-y divide-border overflow-hidden rounded-lg border",
    row: "p-3.5",
    rowTop: "flex items-center justify-between gap-3",
    name: "text-[13px] font-medium text-foreground",
    note: "mt-1 text-[13px] leading-relaxed text-muted-foreground",
    // A chrome:// address cannot be a link, so it is a value to copy.
    code: "mt-2.5 flex items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-2.5",
    codeText: "min-w-0 flex-1 truncate font-mono text-[11px] text-foreground",
    step: "mt-2 text-[13px] leading-relaxed text-muted-foreground",
    pill: "pointer-events-auto absolute right-3 bottom-3 z-40 flex cursor-pointer items-center gap-2 rounded-full border border-[color:var(--border-control)] bg-surface-control-panel py-1.5 pr-3.5 pl-3 text-[13px] font-medium text-foreground-control-muted shadow-editor-control backdrop-blur-[var(--editor-control-backdrop-blur)] transition-colors duration-150 hover:text-foreground-control [&_svg]:size-4",
  },
});

const CopyButton = ({ value }: { readonly value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label="Copy"
      size="icon-sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
};

/** One thing this browser must provide, named the way the browser names it. */
const capabilityChecks = (capabilities: BrowserCapabilities) =>
  [
    {
      available: capabilities.webgpu,
      name: "WebGPU",
      note: "Draws the scene on your graphics processor. Open this page in the latest Google Chrome on a desktop computer.",
    },
    {
      available: capabilities.adapter,
      name: "Graphics acceleration",
      note: "Lets Chrome reach the graphics hardware. Turn on 'Use graphics acceleration when available' in Chrome settings.",
    },
    {
      available: capabilities.requiredFeature,
      name: "shader-f16",
      note: "Runs the motion model at half precision. Update Chrome and your graphics driver, then reload.",
    },
  ] as const;

const CapabilityRow = ({
  available,
  children,
  name,
  note,
}: {
  readonly available: boolean;
  readonly children?: React.ReactNode;
  readonly name: string;
  readonly note: string;
}) => {
  const styles = introStyles();
  return (
    <li className={styles.row()}>
      <div className={styles.rowTop()}>
        <p className={styles.name()}>{name}</p>
        {/* The palette carries one signal colour, so a met requirement says so quietly. */}
        <Badge variant={available ? "secondary" : "destructive"}>
          {available ? "Available" : "Missing"}
        </Badge>
      </div>
      <p className={styles.note()}>{note}</p>
      {available ? null : children}
    </li>
  );
};

/**
 * What this browser can offer the workspace. A missing graphics feature is fatal and does not
 * close; a missing WebMCP is not, and leaves a status over the stage that opens it again.
 */
export const BrowserCapabilityNotice = ({
  capabilities,
  onOpenChange,
  open = false,
}: {
  readonly capabilities: BrowserCapabilities;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
}) => {
  const styles = introStyles();
  const checks = capabilityChecks(capabilities);

  if (checks.some(({ available }) => !available)) {
    return (
      <Dialog open={true}>
        <DialogContent className={styles.dialog()} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>This browser cannot run the scene</DialogTitle>
            <DialogDescription>
              The scene is drawn on your graphics processor and needs a browser feature this
              computer is not offering yet.
            </DialogDescription>
          </DialogHeader>
          <ul className={styles.list()}>
            {checks.map((check) => (
              <CapabilityRow key={check.name} {...check} />
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    );
  }

  if (!open) {
    return capabilities.webMcp ? null : (
      <button
        type="button"
        className={styles.pill()}
        onClick={() => {
          onOpenChange?.(true);
        }}
      >
        <TriangleAlert className="text-destructive" />
        WebMCP unavailable
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog()}>
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>
            {capabilities.webMcp
              ? "Your browser exposes this page's tools over WebMCP, so an agent can drive the scene directly. The built-in agent works as well."
              : "This page publishes its tools over WebMCP. Your browser does not expose them yet, so the built-in agent will drive the scene instead."}
          </DialogDescription>
        </DialogHeader>
        <ul className={styles.list()}>
          <CapabilityRow
            available={capabilities.webMcp}
            name="WebMCP"
            note="Lets an AI agent in your browser read and drive this page directly."
          >
            <span className={styles.code()}>
              <code className={styles.codeText()}>{FLAG_URL}</code>
              <CopyButton value={FLAG_URL} />
            </span>
            <p className={styles.step()}>
              Open that address, set "WebMCP for testing" to Enabled, then relaunch Chrome.
            </p>
          </CapabilityRow>
        </ul>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange?.(false);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
