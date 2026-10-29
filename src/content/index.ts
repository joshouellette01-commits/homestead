import raw from './content.json';
import { parseContent } from './load';

export type * from './schema';
export { ContentError, parseContent } from './load';

export const content = parseContent(raw);
