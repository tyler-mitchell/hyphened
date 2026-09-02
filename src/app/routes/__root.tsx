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
      { title: "ARDY · WebGPU Motion Synthesis" },
      {
        content: "Interactive WebGPU execution of NVIDIA's released streaming motion model.",
        name: "description",
      },
    ],
  }),
  shellComponent: RootDocument,
});
