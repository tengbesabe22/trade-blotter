export function compareDecimalStrings(left: string, right: string): number {
  // Each column has a fixed scale. Compare scaled integers without floating-point rounding.
  const leftUnits = BigInt(left.replace('.', ''));
  const rightUnits = BigInt(right.replace('.', ''));

  if (leftUnits < rightUnits) return -1;
  if (leftUnits > rightUnits) return 1;
  return 0;
}
