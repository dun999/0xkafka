// USDC amounts: the chain counts in micro-units (6 decimals).

export const toMicro = (usdc: string | number) => Math.round(Number(usdc) * 1e6);
export const fromMicro = (micro: number) => micro / 1e6;
