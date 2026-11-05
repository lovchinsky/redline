/** Source of unique identifiers. Implemented in infrastructure (e.g. crypto.randomUUID). */
export interface IdGenerator {
  next(): string;
}
