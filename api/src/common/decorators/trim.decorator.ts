import { Transform, TransformFnParams } from 'class-transformer';

function trimIfString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Recorta espacios al inicio/fin antes de validar (4.7). */
export function Trim(): PropertyDecorator {
  return Transform(trimIfString);
}
