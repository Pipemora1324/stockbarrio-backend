import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const forbidden = (message: string) => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);

const fieldLabels: Record<string, string> = {
  name: 'Nombre',
  email: 'Correo electrónico',
  password: 'Contraseña',
  storeName: 'Nombre de la tienda',
  neighborhood: 'Barrio',
  address: 'Dirección',
  phone: 'Teléfono',
  category: 'Categoría',
  description: 'Descripción',
  price: 'Precio',
  stock: 'Stock',
  expirationDate: 'Fecha de vencimiento',
  discountPercent: 'Descuento',
  imageUrl: 'Imagen',
  id: 'Identificador',
};

const sizeUnits: Record<string, string> = { string: 'caracteres', array: 'elementos' };

const describeLimit = (bound: 'min' | 'max', limit: unknown, inclusive: boolean | undefined, origin: unknown) => {
  const unit = sizeUnits[String(origin)];
  if (unit) return `debe tener ${bound === 'min' ? 'al menos' : 'como máximo'} ${String(limit)} ${unit}`;
  if (inclusive === false) return `debe ser ${bound === 'min' ? 'mayor que' : 'menor que'} ${String(limit)}`;
  return `debe ser ${bound === 'min' ? 'como mínimo' : 'como máximo'} ${String(limit)}`;
};

z.config(z.locales.es());
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type') return issue.input === undefined ? 'es obligatorio' : 'tiene un tipo de dato no válido';
    if (issue.code === 'too_small') return describeLimit('min', issue.minimum, issue.inclusive, issue.origin);
    if (issue.code === 'too_big') return describeLimit('max', issue.maximum, issue.inclusive, issue.origin);
    if (issue.code === 'invalid_format' && issue.format === 'email') return 'no es válido';
    if (issue.code === 'invalid_format' && issue.format === 'uuid') return 'no es un identificador válido';
    if (issue.code === 'unrecognized_keys') return 'tiene campos no permitidos';
    return undefined;
  },
});

export const formatZodError = (error: ZodError) => {
  const errors = error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    const label = fieldLabels[String(issue.path[0] ?? '')] ?? (field || 'La petición');
    const message = /^[A-ZÁÉÍÓÚÑ]/.test(issue.message) ? issue.message : `${label} ${issue.message}.`;
    return { field, message };
  });
  return { message: errors.map((item) => item.message).join(' '), errors };
};

const postgresErrors: Record<string, { status: number; message: string }> = {
  '22P02': { status: 400, message: 'Alguno de los datos enviados no tiene un formato válido.' },
  '22001': { status: 400, message: 'Alguno de los datos enviados es demasiado largo.' },
  '23505': { status: 409, message: 'Ya existe un registro con estos datos.' },
  '23503': { status: 409, message: 'El registro está relacionado con datos que no existen.' },
  '23514': { status: 400, message: 'Alguno de los datos enviados está fuera del rango permitido.' },
};

const isPostgresError = (error: unknown): error is { code: string } =>
  typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code in postgresErrors;

const isBodyParseError = (error: unknown) => typeof error === 'object' && error !== null && (error as { type?: unknown }).type === 'entity.parse.failed';

export const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof AppError) return response.status(error.status).json({ message: error.message });
  if (error instanceof ZodError) return response.status(400).json(formatZodError(error));
  if (isBodyParseError(error)) return response.status(400).json({ message: 'El cuerpo de la petición no es un JSON válido.' });
  if (isPostgresError(error)) return response.status(postgresErrors[error.code].status).json({ message: postgresErrors[error.code].message });
  console.error(error);
  return response.status(500).json({ message: 'Ha ocurrido un error inesperado.' });
};
