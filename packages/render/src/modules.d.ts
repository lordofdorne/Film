/** Remotion's webpack config emits font files as asset/resource URLs. */
declare module "*.woff2" {
  const url: string;
  export default url;
}
