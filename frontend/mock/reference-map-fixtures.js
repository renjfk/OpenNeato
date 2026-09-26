const EXAMPLE_REFERENCE_FILENAME = "mapdata-house-05.jsonl";

const EXAMPLE_REFERENCE_CONFIG = {
    version: 1,
    name: "__example_ground_floor__",
    zones: [
        {
            id: "room-living",
            name: "__example_living_room__",
            color: "#30D158",
            points: [
                { x: 0.05, y: 0.95 },
                { x: 2.4, y: 0.95 },
                { x: 2.4, y: 3.55 },
                { x: 0.05, y: 3.55 },
            ],
        },
        {
            id: "room-kitchen",
            name: "__example_kitchen__",
            color: "#0A84FF",
            points: [
                { x: 2.55, y: 0.95 },
                { x: 5.2, y: 0.95 },
                { x: 5.2, y: 3.55 },
                { x: 2.55, y: 3.55 },
            ],
        },
        {
            id: "room-bedroom",
            name: "__example_bedroom__",
            color: "#BF5AF2",
            points: [
                { x: 0.25, y: -2.7 },
                { x: 2.75, y: -2.7 },
                { x: 2.75, y: -0.2 },
                { x: 0.25, y: -0.2 },
            ],
        },
        {
            id: "room-office",
            name: "__example_office__",
            color: "#FF9F0A",
            points: [
                { x: 3.0, y: -2.2 },
                { x: 5.25, y: -2.2 },
                { x: 5.25, y: -0.2 },
                { x: 3.0, y: -0.2 },
            ],
        },
        {
            id: "room-hallway",
            name: "__example_hallway__",
            color: "#64D2FF",
            points: [
                { x: 0.05, y: 0.05 },
                { x: 5.25, y: 0.05 },
                { x: 5.25, y: 0.7 },
                { x: 0.05, y: 0.7 },
            ],
        },
    ],
    noGoLines: [
        {
            id: "no-go-fireplace",
            name: "__example_fireplace__",
            start: { x: 0.45, y: 3.05 },
            end: { x: 1.15, y: 3.05 },
        },
        {
            id: "no-go-kitchen-island",
            name: "__example_kitchen_island__",
            start: { x: 3.35, y: 2.2 },
            end: { x: 4.55, y: 2.2 },
        },
        {
            id: "no-go-desk-cables",
            name: "__example_desk_cables__",
            start: { x: 4.3, y: -1.7 },
            end: { x: 5.0, y: -1.7 },
        },
    ],
};

const createDefaultMapConfigs = () =>
    new Map([[EXAMPLE_REFERENCE_FILENAME, structuredClone(EXAMPLE_REFERENCE_CONFIG)]]);
const createDefaultPinnedMaps = () => new Set([EXAMPLE_REFERENCE_FILENAME]);

export { EXAMPLE_REFERENCE_CONFIG, EXAMPLE_REFERENCE_FILENAME, createDefaultMapConfigs, createDefaultPinnedMaps };
