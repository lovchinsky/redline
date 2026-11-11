import type { PageRef } from '@redline/core';
import type { ComponentChildren } from 'preact';
import type { LocalFiles } from '../../ports/drafts';
import { useTranslator } from '../shared/i18n';
import { LocalImage, type ImageSource } from './LocalImage';

interface StepItemProps {
  readonly position: number;
  readonly page: PageRef;
  readonly comment: string;
  /** The picture of the step's first circled area, if it has one. */
  readonly image: ImageSource | null;
  readonly files: LocalFiles;
  /** Controls beside the place, for a step that can still be changed. */
  readonly tools?: ComponentChildren;
  /** Shown instead of the comment while it is edited. */
  readonly editor?: ComponentChildren;
  /** Below the comment, above the picture: a pending confirmation, for one. */
  readonly children?: ComponentChildren;
}

/** Where the step was taken: host and route, the way a developer reads it. */
const placeOf = (page: PageRef): string => `${new URL(page.url).host}${page.routePattern}`;

/**
 * One step on the numbered timeline: where it was taken, what the requester wrote, and the
 * picture. A draft's steps and a sent task's steps read the same.
 */
export const StepItem = ({
  position,
  page,
  comment,
  image,
  files,
  tools,
  editor,
  children,
}: StepItemProps) => {
  const t = useTranslator();
  const title = t.text('stepTitle', t.number(position + 1));
  return (
    <li class="step" data-testid="step" aria-label={title}>
      <span class="step-marker" aria-hidden="true">
        {position + 1}
      </span>
      <div class="step-main">
        <div class="step-head">
          <span class="step-place" title={page.title || page.url}>
            {placeOf(page)}
          </span>
          {tools}
        </div>
        {editor ?? (
          <p class="step-comment" data-testid="step-comment">
            {comment}
          </p>
        )}
        {children}
        {image !== null && (
          <LocalImage
            class="step-shot"
            files={files}
            source={image}
            alt={t.text('stepScreenshot', t.number(position + 1))}
          />
        )}
      </div>
    </li>
  );
};
