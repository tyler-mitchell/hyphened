export type CoreAssetNumpyValues =
  | Float32Array
  | Float64Array
  | Int32Array
  | BigInt64Array
  | string[];

export interface CoreAssetNumpyArray {
  readonly dtype: string;
  readonly shape: ReadonlyArray<number>;
  readonly values: CoreAssetNumpyValues;
}

const headerValue = (header: string, expression: RegExp, label: string): string => {
  const value = expression.exec(header)?.[1];
  if (value === undefined) throw new Error(`NumPy asset header is missing ${label}`);
  return value;
};

const product = (shape: ReadonlyArray<number>): number =>
  shape.reduce((result, dimension) => result * dimension, 1);

/** Decode the exact little-endian NumPy dtypes present in the upstream Core skin archive. */
export const parseCoreAssetNumpyArray = (bytes: Uint8Array): CoreAssetNumpyArray => {
  if (
    bytes.byteLength < 10 ||
    bytes[0] !== 0x93 ||
    String.fromCharCode(...bytes.subarray(1, 6)) !== "NUMPY"
  ) {
    throw new Error("Core skin archive entry is not a NumPy array");
  }
  const major = bytes[6];
  const minor = bytes[7];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prefixLength = major === 1 ? 10 : major === 2 ? 12 : 0;
  if (prefixLength === 0 || minor !== 0) {
    throw new Error(`unsupported NumPy asset format ${major}.${minor}`);
  }
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const dataOffset = prefixLength + headerLength;
  const header = new TextDecoder("latin1", { fatal: true }).decode(
    bytes.subarray(prefixLength, dataOffset),
  );
  const dtype = headerValue(header, /['"]descr['"]\s*:\s*['"]([^'"]+)['"]/u, "dtype");
  const fortran = headerValue(header, /['"]fortran_order['"]\s*:\s*(True|False)/u, "fortran_order");
  if (fortran !== "False") throw new Error("Fortran-ordered Core skin arrays are unsupported");
  const shapeSource = headerValue(header, /['"]shape['"]\s*:\s*\(([^)]*)\)/u, "shape");
  const shape = shapeSource
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (
    shape.length === 0 ||
    shape.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
  ) {
    throw new Error(`invalid Core skin NumPy shape (${shapeSource})`);
  }
  const elementCount = product(shape);
  const offset = (index: number, width: number): number => dataOffset + index * width;
  const exactExtent = (width: number): void => {
    if (dataOffset + elementCount * width !== bytes.byteLength) {
      throw new Error(`Core skin ${dtype} data extent does not match [${shape.join(",")}]`);
    }
  };

  if (dtype === "<f4") {
    exactExtent(4);
    return {
      dtype,
      shape,
      values: Float32Array.from({ length: elementCount }, (_unused, index) =>
        view.getFloat32(offset(index, 4), true),
      ),
    };
  }
  if (dtype === "<f8") {
    exactExtent(8);
    return {
      dtype,
      shape,
      values: Float64Array.from({ length: elementCount }, (_unused, index) =>
        view.getFloat64(offset(index, 8), true),
      ),
    };
  }
  if (dtype === "<i4") {
    exactExtent(4);
    return {
      dtype,
      shape,
      values: Int32Array.from({ length: elementCount }, (_unused, index) =>
        view.getInt32(offset(index, 4), true),
      ),
    };
  }
  if (dtype === "<i8") {
    exactExtent(8);
    return {
      dtype,
      shape,
      values: BigInt64Array.from({ length: elementCount }, (_unused, index) =>
        view.getBigInt64(offset(index, 8), true),
      ),
    };
  }
  const unicodeWidth = /^<U(\d+)$/u.exec(dtype)?.[1];
  if (unicodeWidth !== undefined) {
    const codePointCount = Number(unicodeWidth);
    const elementWidth = codePointCount * 4;
    exactExtent(elementWidth);
    return {
      dtype,
      shape,
      values: Array.from({ length: elementCount }, (_unused, index) => {
        const codePoints = Array.from({ length: codePointCount }, (_unusedCodePoint, column) =>
          view.getUint32(dataOffset + index * elementWidth + column * 4, true),
        ).filter((codePoint) => codePoint !== 0);
        return String.fromCodePoint(...codePoints);
      }),
    };
  }
  throw new Error(`unsupported Core skin NumPy dtype ${dtype}`);
};
