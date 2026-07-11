plugins {
    java
}

group = "com.blockhost"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // Paper API for the exact target Minecraft version. compileOnly: the server
    // already provides these classes at runtime, so they must NOT be bundled.
    compileOnly("io.papermc.paper:paper-api:26.1.2.build.74-stable")
}

// Paper 26.x requires Java 25 (the new Minecraft version scheme bumped the runtime),
// so we target Java 25 bytecode to match the paper-api variant and the server runtime.
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.release.set(25)
}

tasks.jar {
    archiveBaseName.set("HostPanel")
    archiveClassifier.set("")
}

// Fail fast if someone renames the main class without updating plugin.yml
tasks.processResources {
    filesMatching("plugin.yml") {
        expand("version" to version)
    }
}
