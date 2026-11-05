import type { AppError } from '@redline/core';
import { CircleAlert } from 'lucide-preact';
import { describeError } from './errors';
import { useTranslator } from './i18n';

/** A failed action, announced to screen readers as soon as it appears. */
export const ErrorAlert = ({ error }: { error: AppError | null }) => {
  const t = useTranslator();
  return error === null ? null : (
    <p role="alert" class="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <span>{describeError(t, error)}</span>
    </p>
  );
};
