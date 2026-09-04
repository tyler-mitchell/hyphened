import { Spinner } from "@hyphened/ui/components/spinner";

/**
 * The only loading state the scene has: the server-rendered first paint, and every moment after it
 * until the scene is open. It paints the app's own background, so hydration changes nothing on
 * screen and the canvas is never shown empty behind it.
 */
export const SceneLoading = () => (
  <div className="fixed inset-0 z-30 grid place-items-center bg-background px-6">
    <section className="flex max-w-sm flex-col items-center text-center">
      <Spinner className="size-5 text-muted-foreground" />
      <p className="mt-5 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Hyphened
      </p>
      <h1 className="mt-2 text-xl font-medium tracking-tight text-foreground">
        Preparing the scene
      </h1>
    </section>
  </div>
);
