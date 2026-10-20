const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Pesos colombianos sin decimales, por ejemplo "$ 18.500", para los textos que la API envía a las personas.
export const formatCop = (value: number) => copFormatter.format(value).replace(/ /g, ' ');
