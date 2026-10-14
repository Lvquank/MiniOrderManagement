import { ValueTransformer } from 'typeorm';

export class ColumnNumericTransformer implements ValueTransformer {
  to(data: number | null): number | null {
    return data;
  }

  from(data: string | null): number | null {
    if (data === null || data === undefined) {
      return null;
    }
    const parsed = parseFloat(data);
    return isNaN(parsed) ? null : parsed;
  }
}
