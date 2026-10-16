const API_URL = "https://api.green-api.com";

function makeUrl(idInstance, apiTokenInstance, method, suffix = "") {
    const id = encodeURIComponent(String(idInstance).trim());
    const token = encodeURIComponent(String(apiTokenInstance).trim());

    return `${API_URL}/waInstance${id}/${method}/${token}${suffix}`;
}

async function readResponse(response) {
    const text = await response.text();
    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!response.ok) {
        const details =
            data?.message ||
            data?.description ||
            data?.error ||
            response.statusText;

        throw new Error(`GREEN-API (${response.status}): ${details}`);
    }

    return data;
}

// Получение состояния инстанса
export async function getStateInstance(idInstance, apiTokenInstance) {
    const response = await fetch(
        makeUrl(idInstance, apiTokenInstance, "getStateInstance")
    );

    return readResponse(response);
}

// Отправка текстового сообщения
export async function sendTextMessage(
    idInstance,
    apiTokenInstance,
    chatId,
    message
) {
    const response = await fetch(
        makeUrl(idInstance, apiTokenInstance, "sendMessage"),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chatId,
                message,
            }),
        }
    );

    return readResponse(response);
}

// Получение входящего уведомления
export async function receiveNotification(
    idInstance,
    apiTokenInstance
) {
    const response = await fetch(
        makeUrl(
            idInstance,
            apiTokenInstance,
            "receiveNotification",
            "?receiveTimeout=5"
        )
    );

    return readResponse(response);
}

// Удаление обработанного уведомления
export async function deleteNotification(
    idInstance,
    apiTokenInstance,
    receiptId
) {
    const response = await fetch(
        makeUrl(
            idInstance,
            apiTokenInstance,
            "deleteNotification",
            `/${encodeURIComponent(String(receiptId))}`
        ),
        {
            method: "DELETE",
        }
    );

    return readResponse(response);
}