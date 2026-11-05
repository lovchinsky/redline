import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Translator } from '../../ports/i18n';

const TranslatorContext = createContext<Translator | null>(null);

/** Makes the surface's translator available to every component below. */
export const TranslatorProvider = ({
  translator,
  children,
}: {
  translator: Translator;
  children: ComponentChildren;
}) => <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;

export const useTranslator = (): Translator => {
  const translator = useContext(TranslatorContext);
  if (translator === null) throw new Error('useTranslator() outside of a TranslatorProvider');
  return translator;
};
