import "./env";
import { prune, UUID } from "./env";
import { VersionState } from "./enum";
/**
 * 路径处理类
 * 实现LocalPath接口，提供路径解析和规范化功能
 * 支持Windows、Unix和相对路径
 */
export class Path implements LocalPath {
    public readonly fullPath: string;   // 归一化后的完整路径
    public readonly directory: string;  // 目录部分
    public readonly fullName: string;   // 文件名（包含拓展名）
    public readonly type: 'Windows' | 'Unix' | 'Relative';
    public readonly extension: string;  // 拓展名（不含点）
    public readonly baseName: string;   // 文件名（不含拓展名）

    /**
     * 构造函数
     * @param inputPath 输入路径字符串
     * @throws 如果路径为空或无效
     */
    constructor(inputPath: string) {
        // 空路径处理
        if (inputPath === "") {
            throw new Error("路径不能为空");
        }

        // 不接受UNC路径（以"\\\\"开头）
        if (this.isUNC(inputPath)) {
            throw new Error("不接受UNC路径");
        }

        // 判断路径类型（Windows绝对、Unix绝对或相对路径）
        const detectedType = this.detectPathType(inputPath);

        // 根据不同平台校验路径基本合法性
        this.validatePath(inputPath, detectedType);

        // 归一化路径：统一分隔符、合并重复分隔符、处理末尾斜杠，并解析导航路径
        const normalized = this.normalizePath(inputPath, detectedType);

        // 从归一化后的路径中提取目录、文件名、基础名与拓展名
        const directory = this.extractDirectory(normalized, detectedType);
        const fileName = this.extractFileName(normalized, detectedType);
        const { baseName, extension } = this.extractBaseAndExtension(fileName);

        this.type = detectedType;
        this.fullPath = normalized;
        this.directory = directory;
        this.fullName = fileName;
        this.baseName = baseName;
        this.extension = extension;
    }

    // 判断是否为UNC路径（以"\\\\"开头）
    /**
     * 判断是否为UNC路径
     * @param path 路径字符串
     * @returns 如果是UNC路径返回true
     */
    private isUNC(path: string): boolean {
        return path.startsWith('\\\\');
    }

    // 判断路径类型：Windows绝对路径、Unix绝对路径或相对路径
    /**
     * 检测路径类型
     * @param path 路径字符串
     * @returns 路径类型: Windows、Unix或Relative
     */
    private detectPathType(path: string): 'Windows' | 'Unix' | 'Relative' {
        // Windows绝对路径：如 "C:\xxx" 或 "C:/xxx"
        if (/^[A-Za-z]:[\\/]/.test(path)) {
            return 'Windows';
        }
        // Unix绝对路径：以 "/" 开头
        if (path.startsWith('/')) {
            return 'Unix';
        }
        // 否则视为相对路径
        return 'Relative';
    }

    // 校验路径合法性：Windows路径检查非法字符，Unix/相对路径检查空字符及非法字符（相对路径）
    /**
     * 验证路径合法性
     * @param path 路径字符串 
     * @param type 路径类型
     * @throws 如果路径包含非法字符或格式不正确
     */
    private validatePath(path: string, type: 'Windows' | 'Unix' | 'Relative'): void {
        const invalidChars = /[<>:"|?*]/;
        if (type === 'Windows') {
            if (!/^[A-Za-z]:[\\/]/.test(path)) {
                throw new Error("无效的Windows路径格式");
            }
            const segments = path.split(/[\\/]/);
            // 驱动器部分不检测，从第二段开始
            for (let i = 1; i < segments.length; i++) {
                let segment = segments[i];
                let variables = [...segment.matchAll(/%#(.*?)#%/g)].map(match => {
                    let variable = match[1].split(':')
                    if (variable.length > 1) {
                        if (invalidChars.test(variable[1])) {
                            throw new Error(`路径变量格式化参数 "${variable[1]}" 含有非法字符`);
                        }
                    }
                    return match[1]
                });
                for (let index = 0; index < variables.length; index++) {
                    const variable = variables[index];
                    segment = segment.replaceAll(variable, '')
                }
                if (invalidChars.test(segment)) {
                    throw new Error(`路径段 "${segments[i]}" 含有非法字符`);
                }
            }
        } else if (type === 'Unix') {
            if (path.indexOf('\0') !== -1) {
                throw new Error("路径中包含非法空字符");
            }
            // Unix路径不进行非法字符检测
        } else if (type === 'Relative') {
            if (path.indexOf('\0') !== -1) {
                throw new Error("路径中包含非法空字符");
            }
            if (invalidChars.test(path)) {
                throw new Error("路径含有非法字符");
            }
        }
    }

    /**
     * 规范化路径
     * @param path 原始路径
     * @param type 路径类型
     * @returns 规范化后的路径
     * 
     * 统一分隔符、合并重复分隔符、处理末尾斜杠，并解析路径中的 "." 和 ".." 导航，绝对路径越界直接抛错。
     */
    private normalizePath(path: string, type: 'Windows' | 'Unix' | 'Relative'): string {
        const sep = type === 'Windows' ? '\\' : '/';

        if (type === 'Windows') {
            // 统一为反斜杠
            path = path.replace(/\//g, '\\');
            path = path.replace(/\\+/g, '\\');
        } else {
            // 对于Unix及相对路径，将反斜杠替换为正斜杠，然后合并重复的斜杠
            path = path.replace(/\\/g, '/');
            path = path.replace(/\/+/g, '/');
        }

        // 拆分路径为段
        let segments: string[];
        if (type === 'Windows') {
            segments = path.split('\\');
        } else {
            segments = path.split('/');
        }

        let isAbsolute = false;
        let prefix = '';
        if (type === 'Windows') {
            // Windows绝对路径的第一段应为驱动器标识，如 "C:"
            if (/^[A-Za-z]:$/.test(segments[0])) {
                isAbsolute = true;
                prefix = segments[0];
                segments = segments.slice(1);
            }
        } else if (type === 'Unix') {
            if (path.startsWith('/')) {
                isAbsolute = true;
                // 去除第一空段（由于首字符为 "/"）
                if (segments[0] === '') {
                    segments = segments.slice(1);
                }
            }
        } else {
            isAbsolute = false;
        }

        // 处理相对导航：解析 "." 与 ".."
        const resolvedSegments = this.resolveSegments(segments, isAbsolute);

        let normalized = '';
        if (type === 'Windows') {
            normalized = prefix ? (prefix + sep + resolvedSegments.join(sep)) : resolvedSegments.join(sep);
            // 保证驱动器路径不为空（如 "C:\"）
            if (prefix && normalized === prefix) {
                normalized += sep;
            }
        } else if (type === 'Unix') {
            normalized = (isAbsolute ? sep : '') + resolvedSegments.join(sep);
            if (isAbsolute && normalized === '') {
                normalized = sep;
            }
        } else {
            normalized = resolvedSegments.join(sep);
        }
        return normalized;
    }

    /**
     * 解析路径段，处理"."和".."导航
     * @param segments 路径段数组
     * @param isAbsolute 是否为绝对路径
     * @returns 处理后的路径段数组
     * @throws 如果是绝对路径且导航越界
     * 
     * 解析路径段，处理 "." 与 ".." 导航，对于绝对路径，如果 ".." 导致越界则抛错
     */
    private resolveSegments(segments: string[], isAbsolute: boolean): string[] {
        const stack: string[] = [];
        for (const segment of segments) {
            if (segment === '' || segment === '.') continue;
            if (segment === '..') {
                if (stack.length > 0 && stack[stack.length - 1] !== '..') {
                    stack.pop();
                } else {
                    if (isAbsolute) {
                        throw new Error("绝对路径不能越界");
                    } else {
                        // 对于相对路径，保留多余的 ".."
                        stack.push('..');
                    }
                }
            } else {
                stack.push(segment);
            }
        }
        return stack;
    }

    /**
     * 提取目录部分
     * @param path 完整路径
     * @param type 路径类型
     * @returns 目录部分字符串
     * 
     * 返回最后一个分隔符之前的内容
     */
    private extractDirectory(path: string, type: 'Windows' | 'Unix' | 'Relative'): string {
        const sep = type === 'Windows' ? '\\' : '/';

        // 特殊处理根目录
        if (type === 'Windows' && /^[A-Za-z]:\\$/.test(path)) {
            return path;
        }
        if (type === 'Unix' && path === '/') {
            return path;
        }

        const lastIndex = path.lastIndexOf(sep);
        return lastIndex === -1 ? '' : path.substring(0, lastIndex);
    }

    /**
     * 提取文件名部分
     * @param path 完整路径
     * @param type 路径类型
     * @returns 文件名部分字符串
     * 
     * 返回最后一个分隔符之后的内容
     */
    private extractFileName(path: string, type: 'Windows' | 'Unix' | 'Relative'): string {
        const sep = type === 'Windows' ? '\\' : '/';
        const lastIndex = path.lastIndexOf(sep);
        return lastIndex === -1 ? path : path.substring(lastIndex + 1);
    }

    /**
     * 分离文件名和扩展名
     * @param fileName 完整文件名
     * @returns 包含baseName和extension的对象
     * 
     * 从文件名中分离基础名称和拓展名
     */
    private extractBaseAndExtension(fileName: string): { baseName: string; extension: string } {
        const lastDot = fileName.lastIndexOf('.');
        if (lastDot <= 0) {
            return { baseName: fileName, extension: '' };
        }
        const baseName = fileName.substring(0, lastDot);
        const extension = fileName.substring(lastDot + 1);
        return { baseName, extension };
    }
}

/**
 * 版本号接口
 * 遵循语义化版本规范(SemVer)
 */
declare interface IVersion {
    major: number;
    minor: number;
    patch: number;
    preRelease: string[];
    buildMetadata: string;
    compare(other: IVersion): VersionState;
}
/**
 * 版本号实现类
 * 支持语义化版本比较和解析
 */
export class Version implements IVersion {
    major: number;
    minor: number;
    patch: number;
    preRelease: string[];
    buildMetadata: string;
    /**
     * 构造函数
     * @param versionString 版本号字符串
     * @throws 如果版本号格式无效
     */
    constructor(versionString: string) {
        if (!versionString || typeof versionString !== 'string') {
            throw new Error("Invalid version string");
        }
        const [version, preRelease, buildMetadata] = versionString.split(/[-+]/);
        const versionParts = version.split('.').map(Number);
        if (versionParts.some(isNaN)) {
            throw new Error("Version string contains invalid numbers");
        }
        this.major = versionParts[0] || 0;
        this.minor = versionParts.length > 1 ? versionParts[1] : 0;
        this.patch = versionParts.length > 2 ? versionParts[2] : 0;
        this.preRelease = preRelease ? preRelease.split('.') : [];
        this.buildMetadata = buildMetadata || '';
    }
    private static compareValues<T extends number | string>(a: T, b: T): VersionState {
        if (a < b) return VersionState.Low;
        if (a > b) return VersionState.High;
        return VersionState.Equal;
    }
    /**
     * 比较版本号
     * @param other 要比较的版本号
     * @returns 比较结果状态
     */
    public compare(other: IVersion): VersionState {
        let state = Version.compareValues(this.major, other.major);
        if (state !== VersionState.Equal) return state;
        state = Version.compareValues(this.minor, other.minor);
        if (state !== VersionState.Equal) return state;
        state = Version.compareValues(this.patch, other.patch);
        if (state !== VersionState.Equal) return state;
        for (let i = 0; i < Math.max(this.preRelease.length, other.preRelease.length); i++) {
            const pre1 = this.preRelease[i] ?? '';
            const pre2 = other.preRelease[i] ?? '';
            state = Version.compareValues(
                isNaN(+pre1) ? pre1 : +pre1,
                isNaN(+pre2) ? pre2 : +pre2
            );
            if (state !== VersionState.Equal) return state;
        }
        return VersionState.Equal;
    }
    /**
     * 转换为字符串
     * @returns 语义化版本字符串
     */
    public toString(): string {
        const version = `${this.major}.${this.minor}.${this.patch}`;
        const preRelease = this.preRelease.length ? `-${this.preRelease.join('.')}` : '';
        const buildMetadata = this.buildMetadata ? `+${this.buildMetadata}` : '';
        return `${version}${preRelease}${buildMetadata}`;
    }
}

/**
 * 字典类
 * 扩展原生Map，提供更方便的转换方法
 * @template T 值类型
 */
export class Dictionary<T> extends Map<string, T> {
    constructor(data: Array<[string, T]> = []) {
        super(data)
    }
    public toArray(): Array<[string, T]> {
        return Array.from(this)
    }
    public keysArray(): Array<string> {
        return Array.from(this.keys())
    }
    public valuesArray(): Array<T> {
        return Array.from(this.values())
    }
}
export class SyncDictionary<T> extends Dictionary<T> {
    /** 当通过 set 或接收消息设置时触发 */
    public onSet?: (key: string, value: T) => void;
    /** 当删除时触发 */
    public onDel?: (key: string) => void;
    /** 完成初次或增量同步后触发 */
    public onSync?: () => void;

    public timestamp: number;
    private id: string;
    private channel: BroadcastChannel;

    /**
     * @param channelName 通信通道，同一名称标签页间同步
     * @param initial 初始纯值列表，会附加当前时戳
     */
    constructor(channelName: string, initial: Array<[string, T]> = []) {
        const hasInitial = prune(initial).any();
        super(hasInitial ? initial : undefined);
        this.timestamp = hasInitial ? Date.now() : 0;
        this.id = UUID();
        this.channel = new BroadcastChannel(channelName);
        this.channel.onmessage = ({ data: msg }: { data: Message<T> }) => this.handleMessage(msg);
        this.channel.postMessage({ type: 'sync', id: this.id, timestamp: this.timestamp });
    }
    /**
     * 重写：设置值并广播，同时记录时间戳
     */
    public override set(key: string, value: T): this {
        this.timestamp = Date.now();
        super.set(key, value);
        this.channel.postMessage({ type: 'set', key, value, timestamp: this.timestamp, id: this.id });
        this.onSet?.(key, value);
        return this;
    }
    /**
     * 重写：删除并广播，同时记录时间戳
     */
    public override delete(key: string): boolean {
        this.timestamp = Date.now();
        const existed = super.delete(key);
        this.channel.postMessage({ type: 'delete', key, timestamp: this.timestamp, id: this.id });
        if (existed) this.onDel?.(key);
        return existed;
    }
    /**
     * 重写：清空并广播，同时记录时间戳
     */
    public override clear(): void {
        this.timestamp = Date.now();
        super.clear();
        this.channel.postMessage({ timestamp: this.timestamp, id: this.id, type: 'state', state: super.toArray() });
        this.onSync?.();
    }
    /**
     * 处理同步消息
     */
    private handleMessage(msg: Message<T>) {
        if (msg.id === this.id) return;
        if (msg.type === 'sync') {
            this.channel.postMessage({ timestamp: this.timestamp, id: this.id, type: 'state', state: super.toArray() });
            return;
        }
        if (msg.timestamp < this.timestamp) return;
        switch (msg.type) {
            case 'state': {
                super.clear();
                for (let index = 0; index < msg.state.length; index++) {
                    const [key, value] = msg.state[index];
                    super.set(key, value);
                }
                this.onSync?.();
                break;
            }
            case 'set': {
                const { key, value } = msg;
                super.set(key, value);
                this.onSet?.(key, value);
                break;
            }
            case 'delete': {
                const { key } = msg;
                if (super.delete(key)) this.onDel?.(key);
                break;
            }
        }
        this.timestamp = Date.now();
    }
}

export class MultiPage {
    public readonly pageId: string;
    public onPageJoin?: (pageId: string) => void;;
    public onPageLeave?: (pageId: string) => void;;
    public onLastPage?: () => void;;

    private readonly channel: BroadcastChannel;
    private beforeUnloadHandler: () => void;

    constructor() {
        this.pageId = UUID();        
        GM_saveTab({ id: this.pageId });
        this.channel = new BroadcastChannel('page-status-channel');
        this.channel.onmessage = (event: MessageEvent<PageEvent>) => this.handleMessage(event.data)
        this.channel.postMessage({ type: 'join', id: this.pageId });
        this.beforeUnloadHandler = () => {
            this.channel.postMessage({ type: 'leave', id: this.pageId });
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
    private handleMessage(message: PageEvent) {
        switch (message.type) {
            case 'join':
                this.onPageJoin?.(message.id);
                break;
            case 'leave':
                this.onPageLeave?.(message.id);
                GM_getTabs((tabs) => {
                    if (Object.keys(tabs).length > 1) return;
                    this.onLastPage?.();
                });
                break;
        }
    }
}
