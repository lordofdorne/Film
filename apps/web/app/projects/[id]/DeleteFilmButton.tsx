"use client";

import { useState, useTransition } from "react";

import { deleteFilmAction } from "../../../src/server/captureActions.js";
import { Button, Notice, Sheet, SheetClose } from "../../../src/ui/index.js";

/**
 * Delete a film that is still being made, after saying exactly what goes.
 *
 * Quiet on the page, because it is the last thing anybody should press by
 * accident; plain in the sheet, because recordings of a real person cannot be
 * got back. No typing the name to confirm: a second, deliberate press in a
 * sheet that names what is lost is the right weight for a film nobody has
 * approved yet.
 */
export const DeleteFilmButton = ({
  projectId,
  name,
}: {
  readonly projectId: string;
  /** "Mum’s film", or null when nobody has said who it is for yet. */
  readonly name: string | null;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const film = name ?? "this film";

  return (
    <Sheet
      trigger={<Button variant="quiet">Delete this film</Button>}
      title={`Delete ${film}?`}
      description="Every recording, photo and answer in it is deleted for good. This cannot be undone."
      footer={
        <div className="row">
          <Button
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                // Success redirects home; only a refusal comes back.
                const result = await deleteFilmAction(projectId);
                setError(result.error);
              });
            }}
          >
            {pending ? "Deleting…" : "Delete it for good"}
          </Button>
          <SheetClose asChild>
            <Button variant="secondary">Keep it</Button>
          </SheetClose>
        </div>
      }
    >
      {error === null ? (
        <p className="muted">To make it again later, you would start from the first question.</p>
      ) : (
        <Notice tone="error" title="It was not deleted">
          {error}
        </Notice>
      )}
    </Sheet>
  );
};
