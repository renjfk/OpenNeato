#include "serial_menu.h"

SerialMenu::SerialMenu(const String &title) : title(title) {
}

void SerialMenu::addItem(const String &label, const String &description, std::function<void()> action) {
    items.push_back({label, description, action});
}

void SerialMenu::clearItems() {
    items.clear();
}

void SerialMenu::show() {
    active = true;
    inputMode = MENU_SELECTION;
    inputBuffer = "";
    printMenu();
}

void SerialMenu::hide() {
    active = false;
}

void SerialMenu::printMenu() {
    Serial.println();
    Serial.println(title);
    Serial.println("----------------------------------------");

    for (size_t i = 0; i < items.size(); i++) {
        Serial.print("[");
        Serial.print(i + 1);
        Serial.print("] ");
        Serial.println(items[i].label);
    }

    Serial.println("----------------------------------------");
    Serial.print("Select option (1-");
    Serial.print(items.size());
    Serial.print("): ");
    Serial.flush();
}

void SerialMenu::handleInput() {
    if (!active || !Serial.available()) {
        return;
    }

    while (Serial.available()) {
        char c = Serial.read();

        if (inputMode == MENU_SELECTION) {
            handleMenuInput(c);
        } else {
            handleTextInput(c);
        }
    }
}

void SerialMenu::handleMenuInput(char c) {
    if (c == '\n' || c == '\r') {
        if (inputBuffer.length() > 0) {
            Serial.println();

            int selection = inputBuffer.toInt();
            inputBuffer = "";

            if (selection >= 1 && selection <= (int) items.size()) {
                // Execute the selected action
                items[selection - 1].action();
            } else {
                printError("Invalid selection!");
                printMenu();
            }
        }
    } else if (c == '\b' || c == 127) {
        // Backspace
        if (inputBuffer.length() > 0) {
            inputBuffer.remove(inputBuffer.length() - 1);
            Serial.write('\b');
            Serial.write(' ');
            Serial.write('\b');
        }
    } else if (c >= '0' && c <= '9') {
        inputBuffer += c;
        Serial.write(c);
    }
}

void SerialMenu::handleTextInput(char c) {
    if (c == '\n' || c == '\r') {
        if (inputBuffer.length() > 0 || inputMode == PASSWORD_INPUT) {
            Serial.println();

            if (inputMode == CONFIRMATION) {
                bool confirmed = (inputBuffer == "YES" || inputBuffer == "yes" || inputBuffer == "Y" || inputBuffer ==
                                  "y");
                String temp = inputBuffer;
                inputBuffer = "";
                inputMode = MENU_SELECTION;
                if (confirmCallback) {
                    confirmCallback(confirmed);
                }
            } else {
                String temp = inputBuffer;
                inputBuffer = "";
                inputMode = MENU_SELECTION;
                if (textCallback) {
                    textCallback(temp);
                }
            }
        }
    } else if (c == '\b' || c == 127) {
        // Backspace
        if (inputBuffer.length() > 0) {
            inputBuffer.remove(inputBuffer.length() - 1);
            Serial.write('\b');
            Serial.write(' ');
            Serial.write('\b');
        }
    } else if (c >= 32 && c <= 126) {
        inputBuffer += c;

        // Echo character (hide password)
        if (isPasswordMode) {
            Serial.write('*');
        } else {
            Serial.write(c);
        }
    }
}

void SerialMenu::promptText(const String &prompt, std::function<void(String)> callback) {
    // Flush any leftover characters in serial buffer
    while (Serial.available()) {
        Serial.read();
    }

    Serial.println();
    Serial.print(prompt);
    if (!prompt.endsWith(": ")) Serial.print(": ");

    inputMode = TEXT_INPUT;
    isPasswordMode = false;
    textCallback = callback;
    inputBuffer = "";
}

void SerialMenu::promptPassword(const String &prompt, std::function<void(String)> callback) {
    // Flush any leftover characters in serial buffer
    while (Serial.available()) {
        Serial.read();
    }

    Serial.println();
    Serial.print(prompt);
    if (!prompt.endsWith(": ")) Serial.print(": ");

    inputMode = PASSWORD_INPUT;
    isPasswordMode = true;
    textCallback = callback;
    inputBuffer = "";
}

void SerialMenu::promptConfirmation(const String &prompt, std::function<void(bool)> callback) {
    // Flush any leftover characters in serial buffer
    while (Serial.available()) {
        Serial.read();
    }

    Serial.println();
    Serial.print(prompt);
    if (!prompt.endsWith("? ")) Serial.print("? ");
    Serial.print("(YES/no): ");

    inputMode = CONFIRMATION;
    isPasswordMode = false;
    confirmCallback = callback;
    inputBuffer = "";
}

void SerialMenu::printStatus(const String &message) {
    Serial.println("\n" + message);
}

void SerialMenu::printError(const String &message) {
    Serial.println("\n✗ " + message);
}

void SerialMenu::printSuccess(const String &message) {
    Serial.println("\n✓ " + message);
}

void SerialMenu::printSection(const String &title) {
    Serial.println();
    Serial.println(title);
    Serial.println("----------------------------------------");
}

void SerialMenu::printSeparator() {
    Serial.println("----------------------------------------");
}

void SerialMenu::printKeyValue(const String &key, const String &value) {
    Serial.print(key);
    Serial.print(": ");
    Serial.println(value);
}