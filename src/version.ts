declare const WA_CLI_VERSION: string | undefined;
export const VERSION: string = typeof WA_CLI_VERSION === "string" ? WA_CLI_VERSION : "0.1.0-dev";
