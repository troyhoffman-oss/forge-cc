// Intentional type error: assigning string to number
const count: number = "not a number";

export function broken(): number {
  return count;
}
