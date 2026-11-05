import {
  sameTarget,
  type AnyFragment,
  type Diagnostic,
  type FragmentKind,
  type FragmentTarget,
  type StepCapture,
} from './fragment';

type FragmentOf<K extends FragmentKind> = Extract<AnyFragment, { kind: K }>;

/** Immutable collection of fragments and diagnostics passed along the pipeline. */
export class FragmentSet {
  private constructor(
    readonly fragments: readonly AnyFragment[],
    readonly diagnostics: readonly Diagnostic[],
  ) {}

  static of(
    fragments: readonly AnyFragment[] = [],
    diagnostics: readonly Diagnostic[] = [],
  ): FragmentSet {
    return new FragmentSet(fragments, diagnostics);
  }

  static fromCapture(capture: StepCapture): FragmentSet {
    return new FragmentSet(capture.fragments, capture.diagnostics);
  }

  ofKind<K extends FragmentKind>(kind: K): FragmentOf<K>[] {
    return this.fragments.filter((fragment): fragment is FragmentOf<K> => fragment.kind === kind);
  }

  forTarget(target: FragmentTarget): AnyFragment[] {
    return this.fragments.filter((fragment) => sameTarget(fragment.target, target));
  }

  with(fragments: readonly AnyFragment[]): FragmentSet {
    return new FragmentSet([...this.fragments, ...fragments], this.diagnostics);
  }

  withDiagnostics(diagnostics: readonly Diagnostic[]): FragmentSet {
    return new FragmentSet(this.fragments, [...this.diagnostics, ...diagnostics]);
  }

  map(transform: (fragment: AnyFragment) => AnyFragment): FragmentSet {
    return new FragmentSet(this.fragments.map(transform), this.diagnostics);
  }

  filter(keep: (fragment: AnyFragment) => boolean): FragmentSet {
    return new FragmentSet(this.fragments.filter(keep), this.diagnostics);
  }

  toCapture(): StepCapture {
    return { fragments: this.fragments, diagnostics: this.diagnostics };
  }
}
