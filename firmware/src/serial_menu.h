#ifndef SERIAL_MENU_H
#define SERIAL_MENU_H

#include <Arduino.h>
#include <functional>
#include <vector>

struct MenuItem {
    String label;
    String description;
    std::function<void()> action;
};

enum InputMode {
    MENU_SELECTION,
    TEXT_INPUT,
    PASSWORD_INPUT,
    CONFIRMATION
};

class SerialMenu {
public:
    SerialMenu(const String &title);

    // Menu building
    void addItem(const String &label, const String &description, std::function<void()> action);

    void clearItems();

    // Display
    void show();

    void hide();

    bool isActive() const { return active; }

    // Input handling
    void handleInput();

    // Text input helpers
    void promptText(const String &prompt, std::function<void(String)> callback);

    void promptPassword(const String &prompt, std::function<void(String)> callback);

    void promptConfirmation(const String &prompt, std::function<void(bool)> callback);

    // Message helpers
    void printStatus(const String &message);

    void printError(const String &message);

    void printSuccess(const String &message);

    // Formatting helpers
    void printSection(const String &title);

    void printSeparator();

    void printKeyValue(const String &key, const String &value);

private:
    String title;
    std::vector<MenuItem> items;
    bool active = false;

    // Input state
    InputMode inputMode = MENU_SELECTION;
    String inputBuffer;
    std::function<void(String)> textCallback;
    std::function<void(bool)> confirmCallback;
    bool isPasswordMode = false;

    void printMenu();

    void handleMenuInput(char c);

    void handleTextInput(char c);
};

#endif // SERIAL_MENU_H