#ifndef MAP_CONFIG_PARSER_H
#define MAP_CONFIG_PARSER_H

#include <Arduino.h>
bool parseMapConfig(const String& json, String& error);

#endif
