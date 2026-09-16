import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
export function queryRecorder(resolve: (query: any) => unknown[]) {
  const queries: any[] = [];
  const dialect = new MySqlDialect();
  return {
    queries,
    db: {
      select: (selection?: any) => ({
        from: (table: any) => {
          const q: any = { table: getTableName(table), selection };
          const chain: any = {
            where: (value: any) => {
              q.where = dialect.sqlToQuery(value);
              return chain;
            },
            leftJoin: () => chain,
            orderBy: (...values: any[]) => {
              q.order = values;
              return chain;
            },
            limit: (n: number) => {
              q.limit = n;
              return chain;
            },
            offset: (n: number) => {
              q.offset = n;
              return chain;
            },
            then: (yes: any, no: any) => {
              queries.push(q);
              return Promise.resolve(resolve(q)).then(yes, no);
            },
          };
          return chain;
        },
      }),
    },
  };
}
