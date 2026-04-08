export declare const get: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"quienes_somos">;
    _creationTime: number;
    carouselImages?: string[];
    videoUrl?: string;
    videoTitle?: string;
    videoDescription?: string;
    videoBadge?: string;
    queEsFincasYa: string;
    mision: string;
    vision: string;
    objetivos: string | string[];
    politicas: string | string[];
    trayectoriaTitle: string;
    trayectoriaParagraphs: string;
    stats: {
        value: string;
        label: string;
    }[];
    recognitionTitle: string;
    recognitionSubtitle: string;
    presenciaInstitucional: string;
    updatedAt: number;
}>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    queEsFincasYa?: string;
    mision?: string;
    vision?: string;
    objetivos?: string[];
    politicas?: string[];
    trayectoriaTitle?: string;
    trayectoriaParagraphs?: string;
    stats?: {
        value: string;
        label: string;
    }[];
    recognitionTitle?: string;
    recognitionSubtitle?: string;
    presenciaInstitucional?: string;
    carouselImages?: string[];
    videoUrl?: string;
    videoTitle?: string;
    videoDescription?: string;
    videoBadge?: string;
}, Promise<import("convex/values").GenericId<"quienes_somos">>>;
