import { parse as pegParse } from './grammar';
export function parse(raw) {
    return pegParse(raw);
}
export * from './ast';
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdG9jb2wuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvcHJvdG9jb2wudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssSUFBSSxRQUFRLEVBQUUsTUFBTSxXQUFXLENBQUM7QUFHOUMsTUFBTSxVQUFVLEtBQUssQ0FBRSxHQUFZO0lBQy9CLE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3pCLENBQUM7QUFFRCxjQUFjLE9BQU8sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcnNlIGFzIHBlZ1BhcnNlIH0gZnJvbSAnLi9ncmFtbWFyJztcbmltcG9ydCB7IEV4cHIgfSBmcm9tICcuL2FzdCc7XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZSAocmF3IDogc3RyaW5nKSA6IEV4cHIge1xuICAgIHJldHVybiBwZWdQYXJzZShyYXcpO1xufVxuXG5leHBvcnQgKiBmcm9tICcuL2FzdCc7Il19