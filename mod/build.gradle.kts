plugins {
    java
    id("net.neoforged.moddev") version "2.0.141"
}

group = "com.blockhost"
version = "0.1.0"

neoForge {
    // NeoForge for Minecraft 26.1.2 (runs on Java 25).
    version = "26.1.2.78"

    mods {
        create("hostpanel") {
            sourceSet(sourceSets.main.get())
        }
    }
}

java {
    toolchain {
        // Minecraft 26.x runs on Java 25; the Adoptium JDK 25 is already installed.
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

tasks.jar {
    archiveBaseName.set("HostPanelMod")
}
