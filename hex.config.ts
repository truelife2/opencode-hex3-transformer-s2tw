import { defineHexConfig } from "@hex/commands"
import { convertS2TW, convertS2TWP } from "./hex-s2tw"

export default defineHexConfig({
  transformations: {
    "s2tw": {
      name: "s2tw",
      description: "簡體轉台灣繁體",
      transform: (text) => convertS2TW(text),
    },
    "s2twp": {
      name: "s2twp",
      description: "簡體轉台灣繁體，並替換台灣用語",
      transform: (text) => convertS2TWP(text),
    },
  },
})
