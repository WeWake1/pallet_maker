/**
 * A minimal DXF R12 (AC1009) ASCII writer.
 *
 * R12 is verbose but trivially correct and opens everywhere, which is the whole
 * reason to choose it. Every entity is a flat list of group code and value
 * pairs, one per line, so there is nothing to get wrong but the codes.
 *
 * Note that R12 has no LWPOLYLINE — that entity arrived with R14. A closed
 * outline in R12 is POLYLINE, its VERTEX entities, and SEQEND, which is exactly
 * the verbosity being paid for.
 */

export type Pair = [number, string | number];

/**
 * Group codes carry their own type, and a reader that expects an integer will
 * not take "1.0000". Flags, colours and counts are integers; coordinates and
 * sizes are reals, where four decimals is far finer than a millimetre needs.
 */
function isIntegerCode(code: number): boolean {
  return (
    (code >= 60 && code <= 79) ||
    (code >= 90 && code <= 99) ||
    (code >= 170 && code <= 179) ||
    (code >= 270 && code <= 289)
  );
}

function format(code: number, value: string | number): string {
  if (typeof value !== 'number') return value;
  return isIntegerCode(code) ? String(Math.round(value)) : value.toFixed(4);
}

export function serialize(pairs: Pair[]): string {
  return pairs.map(([code, value]) => `${code}\n${format(code, value)}`).join('\n') + '\n';
}

export interface Point {
  x: number;
  y: number;
}

/** A closed outline. */
export function polyline(layer: string, points: Point[]): Pair[] {
  const pairs: Pair[] = [
    [0, 'POLYLINE'],
    [8, layer],
    [66, 1],
    [70, 1],
    [10, 0],
    [20, 0],
    [30, 0],
  ];
  for (const point of points) {
    pairs.push([0, 'VERTEX'], [8, layer], [10, point.x], [20, point.y], [30, 0]);
  }
  pairs.push([0, 'SEQEND'], [8, layer]);
  return pairs;
}

export function rectangle(
  layer: string,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Pair[] {
  return polyline(layer, [
    { x, y },
    { x: x + dx, y },
    { x: x + dx, y: y + dy },
    { x, y: y + dy },
  ]);
}

export function line(layer: string, from: Point, to: Point): Pair[] {
  return [
    [0, 'LINE'],
    [8, layer],
    [10, from.x],
    [20, from.y],
    [30, 0],
    [11, to.x],
    [21, to.y],
    [31, 0],
  ];
}

export interface TextOptions {
  height: number;
  /** Degrees anticlockwise. Used for dimensions measured up the page. */
  rotation?: number;
  /** Centred on its insertion point, as dimension text should be. */
  centred?: boolean;
}

export function text(layer: string, at: Point, value: string, options: TextOptions): Pair[] {
  const pairs: Pair[] = [
    [0, 'TEXT'],
    [8, layer],
    [10, at.x],
    [20, at.y],
    [30, 0],
    [40, options.height],
    [1, value],
  ];
  if (options.rotation) pairs.push([50, options.rotation]);
  if (options.centred) {
    // R12 wants the second alignment point whenever an alignment is set.
    pairs.push([72, 1], [11, at.x], [21, at.y], [31, 0]);
  }
  return pairs;
}

export interface LayerDefinition {
  name: string;
  /** AutoCAD colour index. */
  colour: number;
}

export interface DxfDocument {
  layers: LayerDefinition[];
  entities: Pair[];
  extents: { min: Point; max: Point };
}

export function document(doc: DxfDocument): string {
  const header: Pair[] = [
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1009'],
    [9, '$INSBASE'],
    [10, 0],
    [20, 0],
    [30, 0],
    [9, '$EXTMIN'],
    [10, doc.extents.min.x],
    [20, doc.extents.min.y],
    [30, 0],
    [9, '$EXTMAX'],
    [10, doc.extents.max.x],
    [20, doc.extents.max.y],
    [30, 0],
    // Millimetres.
    [9, '$INSUNITS'],
    [70, 4],
    [0, 'ENDSEC'],
  ];

  const tables: Pair[] = [
    [0, 'SECTION'],
    [2, 'TABLES'],
    [0, 'TABLE'],
    [2, 'LTYPE'],
    [70, 1],
    [0, 'LTYPE'],
    [2, 'CONTINUOUS'],
    [70, 64],
    [3, 'Solid line'],
    [72, 65],
    [73, 0],
    [40, 0],
    [0, 'ENDTAB'],
    [0, 'TABLE'],
    [2, 'LAYER'],
    [70, doc.layers.length],
  ];
  for (const layer of doc.layers) {
    tables.push(
      [0, 'LAYER'],
      [2, layer.name],
      [70, 0],
      [62, layer.colour],
      [6, 'CONTINUOUS'],
    );
  }
  tables.push([0, 'ENDTAB'], [0, 'ENDSEC']);

  const entities: Pair[] = [[0, 'SECTION'], [2, 'ENTITIES'], ...doc.entities, [0, 'ENDSEC']];

  return serialize([...header, ...tables, ...entities, [0, 'EOF']]);
}
