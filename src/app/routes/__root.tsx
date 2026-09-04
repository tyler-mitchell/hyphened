import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const RootDocument = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <html className="dark h-full" lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body className="h-full overflow-hidden bg-background text-foreground antialiased">
      {children}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Hyphened · a scene an agent can direct" },
      {
        content:
          "Learned human motion on WebGPU, authored through WebMCP: an agent reads the scene, writes the story, cuts the camera, and captures the result.",
        name: "description",
      },
    ],
  }),
  shellComponent: RootDocument,
});
