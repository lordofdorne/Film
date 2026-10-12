import { CaptureProvider } from "./CaptureProvider.js";

/**
 * Everything about one film, inside one provider that outlives the screens.
 *
 * The camera and the upload queue (`CaptureProvider`) belong to the film, not
 * to whichever step is showing, so they live here: above the overview and the
 * wizard alike, mounted while somebody moves between them. It holds no data
 * from the server — every page still guards itself — only what this browser
 * is doing: a camera, and takes on their way up.
 */
export default async function FilmLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  return <CaptureProvider projectId={id}>{children}</CaptureProvider>;
}
