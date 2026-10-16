export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class VersionConflictError extends DomainError {
  constructor() {
    super("El reloj cambió. Actualiza e inténtalo de nuevo.");
    this.name = "VersionConflictError";
  }
}
