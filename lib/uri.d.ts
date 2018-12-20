interface UriDefaultPorts {
    [scheme: string]: number;
}
interface UriQueryParams {
    [name: string]: string;
}
export default class Uri {
    static defaultPorts: UriDefaultPorts;
    static create(source: Uri | string): Uri;
    scheme: string;
    host: string;
    path: string;
    port: number;
    queryParams: UriQueryParams;
    fragment: string;
    authority: string;
    readonly href: string;
    readonly isRelative: boolean;
    readonly isAbsolute: boolean;
    query: string;
    constructor(raw: string);
    toString(): string;
}
export { UriDefaultPorts, UriQueryParams };
