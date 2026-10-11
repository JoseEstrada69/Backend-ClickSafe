import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriaFraude, Plataforma } from '../database/entities';
import {
  CategoryResponse,
  PlatformResponse,
} from './catalog-response.interface';

/** Catálogos de solo lectura (sección 7): solo se devuelven los activos. Administrarlos queda pospuesto (ver CLAUDE.md). */
@Injectable()
export class CatalogsService {
  constructor(
    @InjectRepository(Plataforma)
    private readonly plataformaRepo: Repository<Plataforma>,
    @InjectRepository(CategoriaFraude)
    private readonly categoriaRepo: Repository<CategoriaFraude>,
  ) {}

  async listPlatforms(): Promise<PlatformResponse[]> {
    const plataformas = await this.plataformaRepo.find({
      where: { activa: true },
      order: { nombre: 'ASC' },
    });
    return plataformas.map((p) => ({
      id: p.idPlataforma,
      nombre: p.nombre,
      esOtra: p.esOtra,
    }));
  }

  async listCategories(): Promise<CategoryResponse[]> {
    const categorias = await this.categoriaRepo.find({
      where: { activa: true },
      order: { nombre: 'ASC' },
    });
    return categorias.map((c) => ({
      id: c.idCategoria,
      nombre: c.nombre,
      descripcion: c.descripcion,
    }));
  }
}
