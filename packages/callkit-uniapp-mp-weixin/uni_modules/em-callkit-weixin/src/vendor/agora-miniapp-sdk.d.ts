/**
 * IoT 设备使用的音频编码格式。
 * - `0`: PCMU/G711u 格式。
 * - `8`: PCMA/G711a 格式。
 * - `9`: G722 格式。
 */
export enum AudioCodec {
    PCMU = 0,
    PCMA = 8,
    G722 = 9
}

/**
* 视频流类型。
* - `HIGH`: （默认）高分辨率、高码率的视频大流。
* - `LOW`: 低分辨率、低码率的视频小流。
*/
export enum StreamType {
    HIGH,
    LOW
}

// 加密模式
export enum ENCRYPTION_MODE {
    NONE = 0,
    /** 1: 128-bit AES encryption, XTS mode.
     */
    AES_128_XTS = 1,
    /** 2: 128-bit AES encryption, ECB mode.
     */
    AES_128_ECB = 2,
    /** 3: 256-bit AES encryption, XTS mode.
     */
    AES_256_XTS = 3,
    /** 4: 128-bit SM4 encryption, ECB mode.
     */
    SM4_128_ECB = 4,
    /** 5: 128-bit AES encryption, GCM mode.
     */
    AES_128_GCM = 5,
    /** 6: 256-bit AES encryption, GCM mode.
     */
    AES_256_GCM = 6,
    /** 7: (Default) 128-bit AES encryption, GCM mode, with KDF salt.
     */
    AES_128_GCM2 = 7,
    /** 8: 256-bit AES encryption, GCM mode, with KDF salt.
     */
    AES_256_GCM2 = 8,
    /** Enumerator boundary.
     */
    MODE_END = 9,
}





/**
* 用户 ID 的类型。
* - INT: （默认）32 位无符号整数。建议设置范围：0 到 (2<sup>32</sup>-1)。默认值为 0。
* - STRING: 字符串，长度不超过 255 个字符。
* @note 
* - 使用字符串作为用户 ID 支持与 Native SDK 2.8 及以上版本或 Web SDK 互通。请确保 Native SDK 使用 User Account 加入频道。详见[如何使用 String 型的用户名](https://docs.agora.io/cn/live-streaming-premium-4.x/faq/string)。
* - 一个频道内的所有用户必须使用同样类型的 uid，即必须都为整数或都为字符串。
*/
export enum UidType {
    INT,
    STRING
}



export declare class Client {

    constructor(options: {
        encryptionKey?: string,  // 加密密钥
        encryptionSalt?: string, // 加密盐值
        encryptionMode?: ENCRYPTION_MODE, // 加密模式
    });

    /**
     * 初始化客户端对象。
     *
     * @param appId 你的小程序项目的 App ID。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    init(appId: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
    /**
     * 设置用户角色。
     *
     * 注：如果在主播已 `publish` 的状态下调用该方法将用户角色设置为 `audience`，会导致之前的推流地址无效。
     * @param role 用户角色。选择如下一种角色：
     * - `broadcaster`：将用户角色设置为主播。主播可以调用 {@link publish} 和 {@link unpublish} 方法。
     * - `audience`：(默认) 将用户角色设置为观众。观众不能调用 {@link publish} 和 {@link unpublish} 方法。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    setRole(role: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
    /**
     * 加入频道。
     *
     * @param channelKey 在 app 服务器端生成的用于鉴权的 Token：
     * - 安全要求不高：你可以使用控制台生成的临时 Token，详见[生成 Token](https://docs.agora.io/cn/Agora%20Platform/token?platform=All%20Platforms#3-%E7%94%9F%E6%88%90-token)。
     * - 安全要求高：将值设为你的服务端生成的正式 Token，详见[使用 Token 鉴权](https://docs.agora.io/cn/Agora%20Platform/token_server)。
     * @param channel 频道名，能标识直播频道的字符串。
     * @param uid 指定用户的 ID。
     * - INT: 整数作为用户 ID，需为 32 位无符号整数。建议设置范围：0 到 (2<sup>32</sup>-1)。需要保证唯一。如果不指定 uid（即设为 null），服务器会报错。
     * - STRING: 字符串，长度不超过 255 个字符。
     * @param isAudioOnly 是否为纯音频场景：
     * - `true`：纯音频场景。
     * - `false`：非纯音频场景。
     * @param UidType 用户 ID 类型, 可选字段, 默认值为 INT 值 0。详见 {@link UidType}。
     * @param onSuccess 方法调用成功时执行的回调函数。返回值为用户 ID。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    join(
        channelKey: string,
        channel: string,
        uid: number | string,
        isAudioOnly: boolean,
        UidType?: UidType,
        onSuccess?: (uid: number) => void,
        onFailure?: (err: { code: number, reason: string }) => void,
    ): Promise<void>;
    /**
     * 发布本地音视频流。
     *
     * 该方法将本地音视频流发布到 SD-RTN。互动直播中，调用该 API 的用户即默认为主播。
     * @param onSuccess 方法调用成功时执行的回调函数。返回值为音视频流的推流地址。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     * 
     * @return
     * string 型，音视频流的推流地址。
     */
    publish(onSuccess?: (url: string) => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<string>;
    /**
     * 停止发布本地音视频流。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    unpublish(onSuccess?: () => void,
        onFailure?: (err: any) => void
    ): Promise<void>;
    /**
     * 订阅远端音视频流。
     *
     * 该方法从 SD-RTN 订阅并接收远端音视频流。
     *
     * @param uid 要订阅的远端用户 ID。
     * @param options 设置是否订阅视频或音频。
     * @param onSuccess 方法调用成功时执行的回调函数。返回值为音视频的拉流地址。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     * 
     * @return
     * 一个对象，包含以下数据：
     * - `url`：string 型，音视频流的拉流地址
     * - `rotation`：number 型，视频帧顺时针旋转角度。
     */
    subscribe(uid: number,
        options?:
            /**
             * @param audio 是否订阅音频流：
             * - `true`：（默认）订阅。
             * - `false`：不订阅。
             * @param video 是否订阅视频流：
             * - `true`：（默认）订阅。
             * - `false`：不订阅。
             */
            { audio?: boolean; video?: boolean },
        onSuccess?: (url: string, rotation: number) => void,
        onFailure?: (err: any) => void
    ): Promise<object>;
    /**
     * 停止订阅远端音视频流。
     *
     * 该方法停止从 SD-RTN 订阅并接收远端音视频流。
     * @param uid 要停止订阅的远端用户 ID。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用成功时执行的回调函数。返回值为错误码和错误信息。
     */
    unsubscribe(uid: number,
        onSuccess?: () => void,
        onFailure?: (err: any) => void
    ): Promise<void>;
    /**
     * 停止发送本地用户的音视频流。
     * @param target 选择停止发送哪一种流，有三种选择：
     * - `audio`：本地用户发送的音频流，即声音。
     * - `video`：本地用户发送的视频流，即视频画面。
     * - `all`：本地用户发送的音视频流，即声音和视频画面。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    muteLocal(target: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
    /**
     * 恢复发送本地用户的音视频流。
     * @param target 选择恢复发送哪一种流，有三种选择：
     * - `audio`：本地用户发送的音频流，即声音。
     * - `video`：本地用户发送的视频流，即视频画面。
     * - `all`：本地用户发送的音视频流，即声音和视频画面。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    unmuteLocal(target: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
    /**
     * 停止接收远端用户的音视频流。
     *
     * @param uid 远端用户的 ID。
     * @param target 选择停止接收哪一种流，有三种选择：
     * - `audio`：远端用户发送的音频流，即声音。
     * - `video`：远端用户发送的视频流，即视频画面。
     * - `all`：远端用户发送的音视频流，即声音和视频画面。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    mute(uid: number,
        target: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
    /**
     * 恢复接收远端用户的音视频流。
     * @param uid 远端用户的 ID。
     * @param target 选择停止接收哪一种流，有三种选择：
     * - `audio`：远端用户发送的音频流，即声音。
     * - `video`：远端用户发送的视频流，即视频画面。
     * - `all`：远端用户发送的音视频流，即声音和视频画面。
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    unmute(uid: number,
        target: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;

    /**
     * 开始跨频道媒体流转发。
     *
     * 该方法可用于实现跨频道媒体流转发。
     *
     * 调用该方法后，SDK 会触发以下回调：
     *
     * - `Client.on("channel-media-relay-state")`，报告当前的跨频道媒体流转发状态和错误码。
     *   - 如果转发成功，该回调中 `state` 为 2，`code` 为 0。
     *   - 如果转发出现异常，该回调中 `state` 为 3，`code` 为错误码。你可以尝试再次调用本方法。
     * - `Client.on("channel-media-relay-event")`，报告跨频道媒体流转发相关的事件。
     *   - 如果转发成功，该回调中 `code` 为 4，表示 SDK 开始向目标频道发送数据包。
     *
     * **Note**
     *
     * - 跨频道媒体流转发功能需要[提交工单](https://agora-ticket.agora.io/)联系技术支持开通。
     * - 该功能不支持 String 型 UID。
     * - 请在成功加入频道后调用该方法。
     * - 直播场景下，只有主播可以调用该方法。
     * - 成功调用该方法后，若你想再次调用该方法，必须先调用 {@link stopChannelMediaRelay} 方法退出当前的转发状态。
     *
     * @param config 跨频道媒体流转发参数配置，详见 {@link ChannelMediaRelayConfiguration}。
     * @param callback 媒体流转发是否成功的回调。
     *
     * - `null`：媒体流转发成功。
     * - 如果失败，会通过 {@link ChannelMediaError} 提供错误信息。
     *
     * @example **示例代码**
     * ```javascript
     * client.startChannelMediaRelay(channelMediaConfig, function(e) {
     *   if(e) {
     *     utils.notification(`startChannelMediaRelay failed: ${JSON.stringify(e)}`);
     *   } else {
     *     utils.notification(`startChannelMediaRelay success`);
     *   }
     * });
     * ```
     */
    startChannelMediaRelay(config: ChannelMediaRelayConfiguration, callback: (err: null | ChannelMediaError) => void): void;
    /**
     * 更新媒体流转发的目标频道。
     *
     * 成功开始跨频道转发媒体流后，如果你希望添加或删除媒体流转发的目标频道，可以调用该方法。
     *
     * 调用该方法后，SDK 会触发 `Client.on("channel-media-relay-event")` 回调。
     *
     * - 如果更新成功，回调中 `code` 为 7。
     * - 如果更新失败，回调中 `code` 为 8，同时还会触发 `Client.on("channel-media-relay-state")` 回调，其中 `state` 为 3。出错后跨频道媒体流转发状态会被重置，你需要调用 {@link startChannelMediaRelay} 重新开始跨频道媒体流转发。
     *
     * **Note**
     * - 请在 {@link startChannelMediaRelay} 后调用该方法，更新媒体流转发的频道。
     * - 跨频道媒体流转发最多支持 4 个目标频道。
     *
     * @param config 跨频道媒体流转发参数配置，详见 {@link ChannelMediaRelayConfiguration}。
     * @param callback 更新目标频道是否成功的回调。
     * - `null`：更新目标频道成功。
     * - 如果失败，会通过 {@link ChannelMediaError} 提供错误信息。
     *
     * @example **示例代码**
     * ```javascript
     * client.updateChannelMediaRelay(channelMediaConfig, function(e) {
     *   if(e) {
     *     utils.notification(`updateChannelMediaRelay failed: ${JSON.stringify(e)}`);
     *   } else {
     *     utils.notification(`updateChannelMediaRelay success`);
     *   }
     * });
     * ```
     */
    updateChannelMediaRelay(config: ChannelMediaRelayConfiguration, callback: (err: null | ChannelMediaError) => void): void;
    /**
     * 停止跨频道媒体流转发。
     *
     * 一旦停止转发，用户会退出所有的目标频道。
     *
     * 调用该方法会触发 `Client.on("channel-media-relay-state")` 回调。
     *
     * - 如果成功停止跨频道媒体流转发，该回调中 `state` 为 0。
     * - 如果未成功停止跨频道媒体流转发，该回调中 `state` 为 3，`code` 错误码可能为 2 或 8，一般是在网络较差的情况下，退出的消息发送不成功导致的。你可以调用 {@link Client.leave} 离开频道来停止跨频道媒体流转发。
     *
     * @param callback 停止跨频道媒体流转发是否成功的回调。
     *
     * - `null`：停止跨频道媒体流转发成功。
     * - 如果失败，会通过 {@link ChannelMediaError} 提供错误信息。
     *
     * @example **示例代码**
     *
     * ```javascript
     * stopChannelMediaRelay: function() {
     *   client.stopChannelMediaRelay(function(e) {
     *     if(e) {
     *       utils.notification(`stopChannelMediaRelay failed: ${JSON.stringify(e)}`);
     *     } else {
     *       utils.notification(`stopChannelMediaRelay success`);
     *     }
     *   });
     * }
     * ```
     */
    stopChannelMediaRelay(callback: (err: null | ChannelMediaError) => void): void;
    /**
     * 用户被服务器禁止。
     * @param event 当前触发的事件。`"client-banned"` 表示用户被服务器禁止。
     * 
     * @since v2.5.4
     * 
     * 当你在服务端踢除频道内的用户后，被踢出频道的用户会收到该回调。
     */
    on(event: "client-banned"
    ): void;
    /**
     * 通知应用程序发生错误。
     * 该回调中会包含详细的错误码和错误信息。
     * @param event 当前触发的事件。`"error"` 表示发生错误。
     * @param callback 具体的事件详情。
     */
    on(event: "error",
        callback: (evt:
            /**
             * @param code 错误码。
             * @param reason 发生错误的原因。
             */
            { code: number, reason: string }) => void
    ): void;
    /**
     * 通知应用程序已添加远端音视频流。
     * 该回调中会包含已添加的远端用户 ID。
     * @param event 当前触发的事件。`"stream-added"` 表示已添加远端音视频流。
     * @param callback 具体的事件详情。
     */
    on(event: "stream-added",
        callback: (evt:
            /**
             * @param uid 远端用户的 ID。
             */
            { uid: number }) => void
    ): void;
    /**
     * 通知应用程序已删除远端音视频流。
     * 该回调中会包含已删除的远端用户 ID。
     * @param event 当前触发的事件。`"stream-removed"` 表示已删除远端音视频流。
     * @param callback 具体的事件详情。
     */
    on(event: "stream-removed",
        callback: (evt:
            /**
             * @param uid 远端用户的 ID。
             */
            { uid: number }) => void
    ): void;
    /**
     * 通知应用程序已更新 URL 地址。
     * 该回调中会包含远端用户的 ID 和更新后的拉流地址。
     * @param event 当前触发的事件。`"update-url"` 表示已更新 URL 地址。
     * @param callback 具体的事件详情。
     */
    on(event: "update-url",
        callback: (evt:
            /**
             * @param uid 远端用户的 ID。
             * @param url 更新后的 URL 地址。
             */
            { uid: number, url: string }) => void
    ): void;
    /**
     * 通知应用程序远端视频已旋转。
     * 该回调中会包含视频的旋转信息以及远端用户的 ID。
     * @param event 当前触发的事件。`"video-rotation"` 表示远端视频已旋转。
     * @param callback 具体的事件详情。
     */
    on(event: "video-rotation",
        callback: (evt:
            /**
             * @param rotation 视频旋转度数。
             * @param uid 远端用户的 ID。
             */
            { rotation: number, uid: number }) => void
    ): void;

    /**
     * Token 已过期回调。
     *
     * @since v2.5.3
     *
     * 在 Token 过期后，会收到该回调。
     *
     * 一般情况下，在收到该消息之后，应向服务端重新申请 Token，并调用 {@link join} 方法传入新的 Token 重新加入频道。
     * @param event 当前触发的事件。`"token-privilege-did-expire"` 表示 Token 已过期。
     *
     */
    on(event: "token-privilege-did-expire"
    ): void;

    /**
     * Token 服务即将过期回调。
     *
     * @since v2.5.3
     *
     * 在调用 {@link join} 时如果指定了 Token，由于 Token 具有一定的时效，在通话过程中如果 Token 即将失效，SDK 会提前 30 秒触发该回调，提醒 App 更新 Token。当收到该回调时，你需要重新在服务端生成新的 Token，
     * 然后调用 {@link renewToken} 将新生成的 Token 传给 SDK。
     * @param event 当前触发的事件。`"token-privilege-will-expire"` 表示 Token 即将过期。
     *
     */
    on(event: "token-privilege-will-expire"
    ): void;

    /**
     * 通知应用程序远端用户已停止发送音频流。
     * 该回调中会包含停止发送音频流的用户 ID。
     * @param event 当前触发的事件。`"mute-audio"` 表示远端用户已停止发送音频流。
     * @param callback 具体的事件详情。
     */
    on(event: "mute-audio", callback: (evt:
        /**
         * @param uid 远端用户的 ID。
         */
        { uid: number }) => void): void;
    /**
     * 通知应用程序远端用户已停止发送视频流。
     * 该回调中会包含停止发送视频流的用户 ID。
     * @param event 当前触发的事件。`"mute-video"` 表示远端用户已停止发送视频流。
     * @param callback 具体的事件详情。
     */
    on(event: "mute-video", callback: (evt:
        /**
         * @param uid 远端用户的 ID。
         */
        { uid: number }) => void): void;
    /**
     * 通知应用程序远端用户已恢复发送音频流。
     * 该回调中会包含恢复发送音频流的用户 ID。
     * @param event 当前触发的事件。`"unmute-audio"` 表示远端用户已恢复发送音频流。
     * @param callback 具体的事件详情。
     */
    on(event: "unmute-audio", callback: (evt:
        /**
         * @param uid 远端用户的 ID。
         */
        { uid: number }) => void): void;
    /**
     * 通知应用程序远端用户已恢复发送视频流。
     * 该回调中会包含恢复发送视频流的用户 ID。
     * @param event 当前触发的事件。`"unmute-video"` 表示远端用户已恢复发送视频流。
     * @param callback 具体的事件详情。
     */
    on(event: "unmute-video", callback: (evt:
        /**
         * @param uid 远端用户的 ID。
         */
        { uid: number }) => void): void;
    /**
     * 跨频道媒体流转发事件回调。
     *
     * 该回调报告跨频道媒体流转发过程中发生的事件。
     * @param event 当前触发的事件。`"channel-media-relay-event"` 表示报告媒体流转发事件。
     * @param callback 具体的事件详情。
     */
    on(event: "channel-media-relay-event",
        callback: (evt:
            /**
             * @param code 事件码：
             * - 0: 网络中断导致用户与服务器连接断开。
             * - 1: 用户与服务器建立连接。
             * - 2: 用户已加入源频道。
             * - 3: 用户已加入目标频道。
             * - 4: SDK 开始向目标频道发送数据包。
             * - 5: 服务器收到了目标频道发送的视频流。
             * - 6: 服务器收到了目标频道发送的音频流。
             * - 7: 目标频道已更新。
             */
            { code: number }) => void
    ): void;
    /**
     * 跨频道媒体流转发状态回调。
     *
     * 当跨频道媒体流转发状态发生改变时，SDK 会触发该回调，并报告当前的转发状态以及相关的错误信息。
     * @param event 当前触发的事件。`"channel-media-relay-state"` 表示媒体流转发状态。
     * @param callback 具体的事件详情。
     */
    on(event: "channel-media-relay-state", callback: (evt:
        /**
         * @param state 状态码：
         * - 0: SDK 正在初始化。
         * - 1: SDK 尝试跨频道。
         * - 2: 源频道主播成功加入目标频道。
         * - 3: 发生异常，详见 `code` 中提示的错误信息。发生异常后，SDK 会重置跨频道媒体流转发的相关状态，你需要调用 {@link startChannelMediaRelay} 重新开始跨频道媒体流转发。
         * @param code 跨频道媒体流转发出错的错误码：
         * - 0: 一切正常。
         * - 1: 服务器回应出错。
         * - 2: 服务器无回应。
         * - 3: SDK 无法获取服务，可能是因为服务器资源有限导致。
         * - 4: 发起跨频道转发媒体流请求失败。
         * - 5: 接受跨频道转发媒体流请求失败。
         * - 6: 服务器接收跨频道转发媒体流失败。
         * - 7: 服务器发送跨频道转发媒体流失败。
         * - 8: SDK 因网络质量不佳与服务器断开，并且重连失败时抛出这个错。此时 SDK 会重置跨频道媒体流转发的相关状态，可以尝试调用 {@link startChannelMediaRelay} 重新进行跨频道媒体流转发。
         * - 9: 服务器内部出错。
         * - 10: 源频道的 Token 已过期。
         * - 11: 目标频道的 Token 已过期。
         * - 12: 已经开始跨频道媒体流转发。该错误一般是因为重复调用 {@link startChannelMediaRelay}，或者在调用 {@link stopChannelMediaRelay} 未成功时就调用了 {@link startChannelMediaRelay}。
         * - 13: 尚未开始跨频道媒体流转发。该错误一般是因为调用 {@link startChannelMediaRelay} 还未成功时就调用了 {@link updateChannelMediaRelay}。
         */
        { state: number, code: number }) => void): void;
    /**
     * 取消监听流事件。
     * @param event 想要取消监听的流事件。
     */
    off(event: string): void;
    /**
     * 重新加入频道。
     *
     * 该方法让用户重新加入声网 RTC 频道。如果你的小程序中有切后台的场景需求，请确保使用该方法做好重连机制。
     * @param channelKey 在 app 服务器端生成的用于鉴权的 Token：
     * - 安全要求不高：你可以使用控制台生成的临时 Token，详见[获取临时 Token](https://doc.shengwang.cn/doc/rtc/mini-program/get-started/enable-service#%E8%8E%B7%E5%8F%96%E4%B8%B4%E6%97%B6-token)。
     * - 安全要求高：将值设为你的服务端生成的正式 Token，详见[从服务端生成 Token](https://doc.shengwang.cn/doc/rtc/android/basic-features/token-authentication)。
     * @param channel 频道名，能标识直播频道的字符串。
     * @param uid 指定用户的 ID。
     * - INT: 整数作为用户 ID，需为 32 位无符号整数。建议设置范围：0 到 (2<sup>32</sup>-1)。需要保证唯一性。如果不指定 uid（即设为 null），服务器会报错。
     * - STRING: 字符串，长度不超过 255 个字符。
     * @param uids 频道内已有用户的用户 ID 列表。
     * @param isAudioOnly 是否为纯音频场景：
     * - `true`：纯音频场景。
     * - `false`：非纯音频场景。
     * @param UidType 用户 ID 类型, 可选字段, 默认值为 INT 值 0。详见 {@link UidType}。
     * @param onSuccess 方法调用成功时执行的回调函数。返回值为用户 ID。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    rejoin(channelKey: string,
        channel: string,
        uid: number | string,
        uids: number,
        isAudioOnly: boolean,
        UidType?: UidType,
        onSuccess?: (uid: number) => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;

    /**
     * 设置 IoT 设备使用的音频编码格式。
     *
     * @since v2.5.6
     * 
     * @param audioCodec IoT 设备使用的音频编码格式，详见{@link AudioCodec}。
     * - 0: PCMU/G711u 格式。
     * - 8: PCMA/G711a 格式。
     * - 9: G722 格式。
     */
    setAudioCodec(audioCodec: AudioCodec): void;

    /**
     * 退出频道。
     *
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    leave(onSuccess?: () => void,
        onFailure?: (err: { code: number; reason: string }) => void
    ): Promise<void>;
    /**
     * 销毁客户端对象。
     * @param onSuccess 方法调用成功时执行的回调函数。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    destroy(onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;

    /**
     * 上报推流过程中的网络状态。
     *
     * @since v2.5.3
     *
     * 当收到 live-pusher 组件报告的网络状态通知时，你可以调用该接口将其上报给声网的数据中心。
     *
     * @param detail 微信事件回调的 `e.detail` 对象。 
     * Note：要收到 live-pusher 组件报告的网络状态通知，你需要在创建 live-pusher 组件时注册监听 `bindnetstatus`。详见[微信小程序 live-pusher 文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-pusher.html)。
     */
    updatePusherNetStatus(detail): void;

    /**
     * 上报推流状态。
     *
     * @since v2.5.3
     *
     * 当收到 live-pusher 组件报告的推流状态变化通知时，你可以调用该接口将其上报给声网的数据中心。
     *
     * @param detail 微信事件回调的 `e.detail` 对象。
     * Note：要收到 live-pusher 组件报告的推流状态码，你需要在创建 live-pusher 组件时注册监听 `bindstatechange`。详见[微信小程序 live-pusher 文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-pusher.html)。
     */
    updatePusherStateChange(detail): void;

    /**
     * 上报拉流过程中的网络状态。
     *
     * @since v2.5.3
     *
     * 当收到 live-player 组件报告的网络状态通知时，你可以调用该接口将其上报给声网的数据中心。
     *
     * @param uid 远端用户的用户 ID。
     * @param detail 微信事件回调的 `e.detail` 对象。 
     * Note：要收到 live-player 组件报告的网络状态数据，你需要在创建 live-player 组件时注册监听 `bindnetstatus`。详见[微信小程序 live-player 文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-player.html)。
     */
    updatePlayerNetStatus(uid: number, detail): void;

    /**
     * 上报拉流状态。
     *
     * @since v2.5.3
     *
     * 当收到 live-player 组件报告的拉流状态变化通知时，你可以调用该接口将其上报给声网的数据中心。
     *
     * @param uid 远端用户的用户 ID。
     * @param detail 微信事件回调的 `e.detail` 对象。 
     * Note：要收到 live-player 组件报告的拉流状态码，你需要在创建 live-player 组件时注册监听 `bindstatechange`。详见[微信小程序 live-player 文档](https://developers.weixin.qq.com/miniprogram/dev/component/live-player.html)。
     */
    updatePlayerStateChange(uid: number, detail): void;

    /**
     * 设置订阅的视频流类型。
     *
     * @since v2.5.3
     *
     * 如果发送端选择发送视频双流 (大流和小流)，该方法可以在订阅端选择接收大流还是小流。如果不设置，订阅端默认接收大流。
     *
     * @param uid 用户 ID。
     * @param type 视频流类型：
     * - `0`：视频大流，即高分辨率、高码率视频流。
     * - `1`：视频小流，即低分辨率、低码率视频流。
     * @param onSuccess 方法调用成功时执行的回调函数。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    setRemoteVideoStreamType(uid: number, streamType: 0 | 1, onSuccess?: (url: string) => void, onFailure?: (err: any) => void): Promise<void>;

    /**
     * 更新 Token。
     *
     * @since v2.5.3
     *
     * 该方法更新 Token。如果启用了 Token 机制，过一段时间后密钥会失效。
     * 当收到 `client.on("token-privilege-will-expire")` 消息时，调用该 API 以更新 Token，否则 SDK 会无法和服务器建立连接。
     *
     * @param token 新的 Token。
     * @param onSuccess 方法调用成功时执行的回调函数。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    renewToken(token: string,
        onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void
    ): Promise<void>;
}

/**
 * 跨频道媒体流转发的配置。
 *
 * 在调用 {@link startChannelMediaRelay} 和 {@link updateChannelMediaRelay} 时，通过该接口设置跨频道媒体流转发的具体信息。
 */
export interface ChannelMediaRelayConfiguration {
    /**
     * 设置源频道信息。
     *
     * @param srcInfo 源频道信息，包含以下参数：
     *
     * - `channelName`：String 类型，源频道的频道名。
     * - `uid`：Number 类型，32 位无符号整数。用于标识源频道中的转发媒体流的 UID，不可与当前主播的 UID 相同，设置范围：0 到 (2<sup>32</sup>-1)，设为 0 服务器会自动分配一个 UID。
     * - `token`：String 类型，用上面设置的频道名和 `uid` 生成的 token。如果未启用 token 则无需设置。
     *
     * @example **示例代码**
     * ``` javascript
     * var configuration = new AgoraRTC.ChannelMediaRelayConfiguration();
     * configuration.setSrcChannelInfo({
     *  channelName: "srcChannel",
     *  uid: 123,
     *  token: "yourSrcToken",
     * })
     * ```
     */
    setSrcChannelInfo(srcInfo: any): void;
    /**
     * 设置目标频道信息。
     *
     * 如果你想将流转发到多个目标频道，可以多次调用该方法。该方法支持最多设置 4 个目标频道。
     *
     * @param channelName 目标频道名，该参数必须与 `destInfo` 参数中的 `channelName` 一致。
     * @param destInfo 目标频道信息，包含以下参数：
     *
     * - `channelName`：String 类型，目标频道名。
     * - `uid`：Number 类型，32 位无符号整数。用于标识目标频道中的转发媒体流的 UID，需确保与目标频道中的其他用户 ID 不同，防止造成互踢，设置范围：0 到 (2<sup>32</sup>-1)，设为 0 服务器会自动分配一个 UID。
     * - `token`：String 类型，用上面设置的频道名和 `uid` 生成的 token。如果未启用 token 则无需设置。
     *
     * @example **示例代码**
     * ``` javascript
     * var configuration = new AgoraRTC.ChannelMediaRelayConfiguration();
     * configuration.setDestChannelInfo("cname", {
     *  channelName: "destChannel",
     *  uid: 123,
     *  token: "yourDestToken",
     * })
     * ```
     */
    setDestChannelInfo(channelName: string, destInfo: any): void;
    /**
     * 删除目标频道
     *
     * @param channelName 想要删除的目标频道名。
     * @example **示例代码**
     * ``` javascript
     * configuration.removeDestChannelInfo("cname")
     * ```
     */
    removeDestChannelInfo(channelName: string): void;
}


export interface Log {

    /**
     * 设置小程序 SDK 输出日志等级。
     * 
     * @param level 日志等级：
     * - `-1`：BLIND，即输出所有 API 日志信息。如果你想获取最完整的日志，可以将日志级别设为该等级。
     * - `0`：DEBUG，即输出所有 API 日志信息。如果你想获取最完整的日志，可以将日志级别设为该等级。
     * - `1`：INFO，即输出 INFO，WARN，ERROR 级别的日志信息。
     * - `2`：WARN，即输出 WARN，ERROR 级别的日志信息。
     * - `3`：ERROR，输出 ERROR 级别的日志信息。
     * - `4`：NONE，即不输出日志信息。
     */
    setLogLevel(level: number): void;

    /**
     * 上传 SDK 日志至服务器。
     * 
     * @since v2.6.0  
     * 
     * 当遇到问题时，为方便问题排查，你需要将出现问题时间段的日志提供给声网支持人员。如果你使用 v2.6.0 及之后版本的 SDK，可以调用该方法上传日志，无需自己保存日志文件。
     *   
     * @param onSuccess 方法调用成功时执行的回调函数。无返回值。
     * @param onFailure 方法调用失败时执行的回调函数。返回值为错误码和错误信息。
     */
    uploadLogs(onSuccess?: () => void,
        onFailure?: (err: { code: number, reason: string }) => void): Promise<void>;

    /**
     * 保存 SDK 日志。
     * 
     * 当遇到问题时，为方便问题排查，你需要将出现问题时间段的日志提供给声网支持人员。如果你使用 v2.6.0 之前版本的 SDK，你可以通过设置该属性保存 SDK 日志。
     * 
     * @example **示例代码**
     * ``` javascript
     * AgoraMiniappSDK.LOG.onLog = (text) => {
     *    // text 为字符串形式
     *    Utils.log(text);
     * };
     * ```
     *
     */
    onLog: Function;

}

/**
 * 跨频道媒体流转发的错误信息。
 *
 * 调用 {@link startChannelMediaRelay}、{@link updateChannelMediaRelay} 或 {@link stopChannelMediaRelay} 出错时，会在方法的回调中通过该类提供具体的错误信息。
 *
 * 该类中 `code` 表示错误码，`message` 表示错误名，对应关系如下表所示：
 *
 * | `code`   | `message`                       | 错误描述                                                     |
 * | -------- | ------------------------------- | ------------------------------------------------------------ |
 * | 0        | RELAY_OK                        |                     一切正常。                                         |
 * | 1        | SERVER_ERROR_RESPONSE           | 服务器回应出错。                                             |
 * | 2        | SERVER_NO_RESPONSE              | 服务器无回应。                                               |
 * | 3        | NO_RESOURCE_AVAILABLE           | SDK 无法获取服务，可能是因为服务器资源有限导致。             |
 * | 4        | FAILED_JOIN_SRC                 | 发起跨频道转发媒体流请求失败。                                       |
 * | 5        | FAILED_JOIN_DEST                | 接受跨频道转发媒体流请求失败。                                 |
 * | 6        | FAILED_PACKET_RECEIVED_FROM_SRC | 服务器接收跨频道转发媒体流失败。                               |
 * | 7        | FAILED_PACKET_SENT_TO_DEST      | 服务器发送跨频道转发媒体流失败。                                         |
 * | 8        | SERVER_CONNECTION_LOST          | SDK 因网络质量不佳与服务器断开，并且重连失败时抛出这个错。此时 SDK 会重置跨频道媒体流转发的相关状态，可以尝试调用 {@link startChannelMediaRelay} 重新进行跨频道媒体流转发。 |
 * | 9        | INTERNAL_ERROR                  | 服务器内部出错。                                             |
 * | 10       | SRC_TOKEN_EXPIRED               | 源频道的 Token 已过期。                                      |
 * | 11       | DEST_TOKEN_EXPIRED              | 目标频道的 Token 已过期。                                    |
 * | 12       | RELAY_ALREADY_START             | 已经开始跨频道媒体流转发。该错误一般是因为重复调用 {@link startChannelMediaRelay}，或者在调用 {@link stopChannelMediaRelay} 未成功时就调用了 {@link startChannelMediaRelay}。 |
 * | 13       | RELAY_NOT_START                 | 尚未开始跨频道媒体流转发。该错误一般是因为调用 {@link startChannelMediaRelay} 还未成功时就调用了 {@link updateChannelMediaRelay}。 |
 */
export class ChannelMediaError {
    /**
     * 附加信息
     */
    data?: any;
    /**
     * 错误码，详见页面上方的表格。
     */
    code: number;
    /**
     * 错误名，详见页面上方的表格。
     */
    message: string;
}
