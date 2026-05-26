const unsupportedPorto = () => {
  throw new Error("Porto connector is not supported in this app");
};

export const Porto = {
  create: unsupportedPorto,
};

export const RpcSchema = {
  wallet_connect: {
    Capabilities: {},
  },
};
