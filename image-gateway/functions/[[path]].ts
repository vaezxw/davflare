import worker, { type Env } from "../src/index";

export const onRequest: PagesFunction<Env> = (context) => {
  return worker.fetch(context.request, context.env, context);
};
