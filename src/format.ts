const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Colombian pesos without decimals, e.g. "$ 18.500", for texts the API sends to users.
export const formatCop = (value: number) => copFormatter.format(value).replace(/ /g, ' ');
