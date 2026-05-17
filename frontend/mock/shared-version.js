const DEFAULT_MOCK_VERSION = "0.0-dev";

function mockVersionFromHash(hash) {
    return hash ? `0.0-${hash}` : DEFAULT_MOCK_VERSION;
}

export { DEFAULT_MOCK_VERSION, mockVersionFromHash };
