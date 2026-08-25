export class UpstreamSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamSearchError";
  }
}

export class UpstreamMarketError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamMarketError";
  }
}

export class UpstreamEventError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamEventError";
  }
}

export class UpstreamOrderbookError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamOrderbookError";
  }
}

export class UpstreamPriceHistoryError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "UpstreamPriceHistoryError";
  }
}
