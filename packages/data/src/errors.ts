/** A query that reached the data layer without a company context, or tried to leave its company (document 05, section 12). */
export class CompanyContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyContextError";
  }
}
