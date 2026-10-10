import { useState, useEffect, useRef } from "react";
import "./App.css";
import {
    sendTextMessage,
    receiveNotification,
    deleteNotification,
} from "./api";

// Собирает chatId из любого формата номера. Возвращает null, если номер некорректен.
// 8XXXXXXXXXX и 7XXXXXXXXXX — оба → 7XXXXXXXXXX@c.us.
// 10 цифр без кода → добавляем 7.
function buildChatId(rawPhone) {
    const digits = String(rawPhone).replace(/\D/g, "");
    if (!digits) return null;

    if (digits.length === 11 && digits.startsWith("8")) {
        return "7" + digits.slice(1) + "@c.us";
    }
    if (digits.length === 11 && digits.startsWith("7")) {
        return digits + "@c.us";
    }
    if (digits.length === 10) {
        return "7" + digits + "@c.us";
    }
    if (digits.length >= 11) {
        return digits + "@c.us";
    }
    return null;
}

// Красиво форматирует номер для отображения в списке чатов.
function formatPhone(rawPhone) {
    const digits = String(rawPhone).replace(/\D/g, "");
    let d = digits;
    if (digits.length === 11 && digits.startsWith("8")) {
        d = "7" + digits.slice(1);
    }
    if (d.length === 11 && d.startsWith("7")) {
        return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
    }
    return "+" + d;
}

export default function App() {
    // --- Авторизация (sessionStorage — живёт одну сессию браузера) ---
    const [idInstance, setIdInstance] = useState(
        () => sessionStorage.getItem("max-chat:idInstance") || ""
    );
    const [apiTokenInstance, setApiTokenInstance] = useState(
        () => sessionStorage.getItem("max-chat:apiTokenInstance") || ""
    );
    const [isAuthorized, setIsAuthorized] = useState(
        () =>
            Boolean(
                sessionStorage.getItem("max-chat:idInstance") &&
                    sessionStorage.getItem("max-chat:apiTokenInstance")
            )
    );

    // --- Чаты и сообщения (localStorage — живут между перезагрузками) ---
    const [chats, setChats] = useState(
        () => JSON.parse(localStorage.getItem("max-chat:chats") || "[]")
    );
    const [activeChat, setActiveChat] = useState(
        () => localStorage.getItem("max-chat:activeChat") || null
    );
    const [messages, setMessages] = useState(
        () => JSON.parse(localStorage.getItem("max-chat:messages") || "{}")
    );

    // --- Поля ввода ---
    const [newPhone, setNewPhone] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [draftMessage, setDraftMessage] = useState("");

    const pollingRef = useRef(null);

    // --- Синхронизация с хранилищами ---
    useEffect(() => {
        localStorage.setItem("max-chat:chats", JSON.stringify(chats));
    }, [chats]);

    useEffect(() => {
        localStorage.setItem("max-chat:messages", JSON.stringify(messages));
    }, [messages]);

    useEffect(() => {
        if (activeChat) localStorage.setItem("max-chat:activeChat", activeChat);
        else localStorage.removeItem("max-chat:activeChat");
    }, [activeChat]);

    // --- Авторизация ---
    function handleAuthorize() {
        const instance = idInstance.trim();
        const token = apiTokenInstance.trim();
        if (!instance || !token) return;

        sessionStorage.setItem("max-chat:idInstance", instance);
        sessionStorage.setItem("max-chat:apiTokenInstance", token);
        setIdInstance(instance);
        setApiTokenInstance(token);
        setIsAuthorized(true);
    }

    function handleLogout() {
        sessionStorage.removeItem("max-chat:idInstance");
        sessionStorage.removeItem("max-chat:apiTokenInstance");
        setIsAuthorized(false);
    }

    // --- Создание чата ---
    function handleCreateChat() {
        const raw = newPhone.trim();
        if (!raw) return;

        const chatId = buildChatId(raw);
        if (!chatId) {
            alert("Введите корректный номер телефона");
            return;
        }

        const displayName = formatPhone(raw);

        // Функциональное обновление — всегда видим актуальный список.
        // Проверка на дубликат — ВНУТРИ updater, а не снаружи по замыканию.
        setChats((currentChats) => {
            const exists = currentChats.some((chat) => chat.chatId === chatId);
            if (exists) return currentChats;
            return [...currentChats, { chatId, name: displayName }];
        });

        setActiveChat(chatId);
        setNewPhone("");
    }

    // --- Удаление чата ---
    function handleDeleteChat(chatId, event) {
        event.stopPropagation();
        if (!window.confirm("Удалить чат вместе с сообщениями?")) return;

        setChats((currentChats) => currentChats.filter((c) => c.chatId !== chatId));
        setMessages((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
        });
        if (activeChat === chatId) setActiveChat(null);
    }

    // --- Отправка сообщения ---
    async function handleSendMessage() {
        const text = draftMessage.trim();
        if (!text || !activeChat) return;

        try {
            await sendTextMessage(idInstance, apiTokenInstance, activeChat, text);
            setMessages((prev) => ({
                ...prev,
                [activeChat]: [
                    ...(prev[activeChat] || []),
                    { id: Date.now(), text, fromMe: true },
                ],
            }));
            setDraftMessage("");
        } catch (error) {
            console.error("Ошибка отправки:", error);
            alert("Не удалось отправить сообщение");
        }
    }

    // --- Polling входящих уведомлений ---
    useEffect(() => {
        if (!isAuthorized) return;

        async function poll() {
            try {
                const note = await receiveNotification(idInstance, apiTokenInstance);
                if (!note) return;

                const chatId = note.body?.senderData?.chatId;
                const text = note.body?.messageData?.textMessageData?.textMessage;

                if (chatId && typeof text === "string") {
                    setMessages((prev) => ({
                        ...prev,
                        [chatId]: [
                            ...(prev[chatId] || []),
                            { id: note.receiptId ?? Date.now(), text, fromMe: false },
                        ],
                    }));

                    // Если пришло сообщение от нового контакта — автоматически
                    // добавляем его чат в список.
                    setChats((currentChats) => {
                        if (currentChats.some((c) => c.chatId === chatId)) {
                            return currentChats;
                        }
                        const phone = chatId.replace(/@c\.us$/, "");
                        return [...currentChats, { chatId, name: formatPhone(phone) }];
                    });
                }

                if (note.receiptId != null) {
                    await deleteNotification(idInstance, apiTokenInstance, note.receiptId);
                }
            } catch (error) {
                console.error("Не удалось получить уведомление:", error);
            }
        }

        poll();
        pollingRef.current = setInterval(poll, 5000);
        return () => clearInterval(pollingRef.current);
    }, [isAuthorized, idInstance, apiTokenInstance]);

    const currentChat = chats.find((chat) => chat.chatId === activeChat);

    // --- Фильтр поиска ---
    const filteredChats = chats.filter((chat) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            chat.name.toLowerCase().includes(q) ||
            chat.chatId.toLowerCase().includes(q)
        );
    });

    // --- Экран авторизации ---
    if (!isAuthorized) {
        return (
            <div className="auth">
                <div className="auth-card">
                    <h1>Вход</h1>
                    <input
                        placeholder="idInstance"
                        value={idInstance}
                        onChange={(e) => setIdInstance(e.target.value)}
                    />
                    <input
                        type="password"
                        placeholder="apiTokenInstance"
                        value={apiTokenInstance}
                        onChange={(e) => setApiTokenInstance(e.target.value)}
                    />
                    <button onClick={handleAuthorize}>Войти</button>
                </div>
            </div>
        );
    }

    // --- Основной интерфейс рендерим ---
    return (
        <div className="app">
            <aside className="sidebar">
                <div className="sidebar-top">
                    <h2>Чаты</h2>
                    <button onClick={handleLogout} title="Выйти">⎋</button>
                </div>

                <div className="new-chat-row">
                    <input
                        className="field"
                        placeholder="+7 999 123-45-67"
                        type="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreateChat()}
                    />
                    <button onClick={handleCreateChat} title="Добавить">+</button>
                </div>

                <input
                    className="field"
                    placeholder="Поиск по имени или номеру"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />

                <ul>
                    {filteredChats.map((chat) => (
                        <li
                            key={chat.chatId}
                            className={chat.chatId === activeChat ? "active" : ""}
                            onClick={() => setActiveChat(chat.chatId)}
                        >
                            <span className="chat-name">{chat.name}</span>
                            <button
                                className="delete-btn"
                                onClick={(e) => handleDeleteChat(chat.chatId, e)}
                                title="Удалить"
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            </aside>

            <main className="chat">
                {!currentChat ? (
                    <div className="empty">Выберите чат</div>
                ) : (
                    <>
                        <header className="chat-top">{currentChat.name}</header>

                        <div className="messages">
                            {(messages[currentChat.chatId] || []).map((message) => (
                                <div
                                    key={message.id}
                                    className={message.fromMe ? "msg out" : "msg in"}
                                >
                                    {message.text}
                                </div>
                            ))}
                        </div>

                        <footer className="chat-bottom">
                            <input
                                placeholder="Сообщение..."
                                value={draftMessage}
                                onChange={(e) => setDraftMessage(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                            />
                            <button onClick={handleSendMessage}>Отправить</button>
                        </footer>
                    </>
                )}
            </main>
        </div>
    );
}